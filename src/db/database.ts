/**
 * Camada de banco local (SQLite) do PDV Canto da Sorte.
 *
 * App OFFLINE-FIRST: todas as operações gravam no SQLite local e enfileiram
 * mutações em `sync_queue` para o motor de sincronização enviar ao Supabase
 * quando houver internet.
 *
 * API assíncrona moderna do expo-sqlite (openDatabaseAsync + runAsync/getAllAsync).
 * Todos os identificadores novos usam nanoid (variante não-segura, compatível com
 * React Native sem polyfill de crypto).
 */
import * as SQLite from 'expo-sqlite';
import { nanoid } from 'nanoid/non-secure';

import type {
  OrderItem,
  PaymentMethod,
  Product,
  Sale,
  Section,
  Table,
} from '../types';
import { buildSeedRows } from '../data/seed';

/** Nome do arquivo do banco local. */
const DB_NAME = 'canto_da_sorte.db';

/**
 * Entidades sincronizáveis (usadas na fila de sync).
 * IMPORTANTE: os valores são exatamente os NOMES DAS TABELAS no Supabase (plural,
 * snake_case). O motor de sync usa `supabase.from(entity)` diretamente, então o
 * que é enfileirado aqui precisa casar 1:1 com o schema remoto.
 */
export type SyncEntity =
  | 'sections'
  | 'products'
  | 'tables'
  | 'order_items'
  | 'sales';

/** Operação registrada na fila de sincronização. */
export type SyncOp = 'upsert' | 'delete';

/** Item pendente na fila de sincronização. */
export interface SyncQueueItem {
  id: number;
  entity: SyncEntity;
  entityId: string;
  op: SyncOp;
  payload: unknown;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Conexão (singleton)
// ---------------------------------------------------------------------------

let dbInstance: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Retorna a conexão aberta com o banco. Garante que `initDatabase()` já rodou.
 * Uso interno — as funções públicas chamam isto antes de qualquer query.
 */
async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  return initDatabase();
}

// ---------------------------------------------------------------------------
// Helpers de linha (row -> tipo de domínio)
// ---------------------------------------------------------------------------

interface SectionRow {
  id: string;
  label: string;
  position: number;
  updated_at: number;
  deleted: number;
}

interface ProductRow {
  id: string;
  section_id: string;
  name: string;
  price: number;
  icon: string;
  image_url: string;
  available: number;
  position: number;
  updated_at: number;
  deleted: number;
}

interface TableRow {
  id: string;
  num: string;
  name: string;
  status: string;
  opened_at: number;
  updated_at: number;
  deleted: number;
}

interface OrderItemRow {
  id: string;
  table_id: string;
  product_id: string;
  name: string;
  price: number;
  qty: number;
}

interface SaleRow {
  id: string;
  table_id: string;
  table_name: string;
  items_json: string;
  total: number;
  payment: string;
  closed_at: number;
  synced: number;
}

function mapSection(r: SectionRow): Section {
  return {
    id: r.id,
    label: r.label,
    position: r.position,
    updatedAt: r.updated_at,
    deleted: r.deleted === 1,
  };
}

function mapProduct(r: ProductRow): Product {
  return {
    id: r.id,
    sectionId: r.section_id,
    name: r.name,
    price: r.price,
    icon: r.icon,
    imageUrl: r.image_url ?? '',
    available: r.available === 1,
    position: r.position,
    updatedAt: r.updated_at,
    deleted: r.deleted === 1,
  };
}

function mapOrderItem(r: OrderItemRow): OrderItem {
  return {
    id: r.id,
    productId: r.product_id,
    name: r.name,
    price: r.price,
    qty: r.qty,
  };
}

function mapTable(r: TableRow, items: OrderItem[]): Table {
  return {
    id: r.id,
    num: r.num,
    name: r.name,
    status: r.status === 'ocupada' ? 'ocupada' : 'livre',
    items,
    openedAt: r.opened_at,
    updatedAt: r.updated_at,
    deleted: r.deleted === 1,
  };
}

function mapSale(r: SaleRow): Sale {
  let items: OrderItem[] = [];
  try {
    const parsed = JSON.parse(r.items_json);
    if (Array.isArray(parsed)) items = parsed as OrderItem[];
  } catch {
    items = [];
  }
  return {
    id: r.id,
    tableId: r.table_id,
    tableName: r.table_name,
    items,
    total: r.total,
    payment: r.payment as PaymentMethod,
    closedAt: r.closed_at,
    synced: r.synced === 1,
  };
}

// ---------------------------------------------------------------------------
// Fila de sincronização
// ---------------------------------------------------------------------------

/**
 * Conversores domínio (camelCase) -> linha remota do Supabase (snake_case).
 *
 * O payload enfileirado é enviado CRU ao Supabase via `supabase.from(...).upsert(row)`,
 * então precisa ter EXATAMENTE os nomes de coluna do schema remoto (ver
 * supabase/schema.sql). Booleans viram 0/1 para casar com o SQLite/consistência,
 * e o Postgres aceita 0/1 em coluna boolean. Para delete lógico, enviamos a linha
 * com `deleted: 1` (last-write-wins por updated_at).
 */
function remoteSection(s: Section): Record<string, unknown> {
  return {
    id: s.id,
    label: s.label,
    position: s.position,
    updated_at: s.updatedAt,
    deleted: Boolean(s.deleted),
  };
}
function remoteProduct(p: Product): Record<string, unknown> {
  return {
    id: p.id,
    section_id: p.sectionId,
    name: p.name,
    price: p.price,
    icon: p.icon ?? '',
    image_url: p.imageUrl ?? '',
    available: Boolean(p.available),
    position: p.position,
    updated_at: p.updatedAt,
    deleted: Boolean(p.deleted),
  };
}
function remoteTable(t: Table): Record<string, unknown> {
  return {
    id: t.id,
    num: t.num,
    name: t.name,
    status: t.status,
    opened_at: t.openedAt,
    updated_at: t.updatedAt,
    deleted: Boolean(t.deleted),
  };
}
function remoteOrderItem(
  tableId: string,
  it: { id: string; productId: string; name: string; price: number; qty: number },
  deleted = false,
): Record<string, unknown> {
  return {
    id: it.id,
    table_id: tableId,
    product_id: it.productId,
    name: it.name,
    price: it.price,
    qty: it.qty,
    // A tabela remota order_items tem soft-delete; deletes viram upsert com
    // deleted=true (LWW por updated_at), coerente com as demais entidades.
    deleted: Boolean(deleted),
    updated_at: Date.now(),
  };
}
function remoteSale(sale: Sale): Record<string, unknown> {
  return {
    id: sale.id,
    table_id: sale.tableId,
    table_name: sale.tableName,
    items_json: JSON.stringify(sale.items ?? []),
    total: sale.total,
    payment: sale.payment,
    closed_at: sale.closedAt,
    synced: Boolean(sale.synced),
  };
}
/** Payload mínimo para um delete lógico por id (a linha remota some via deleted=1
 *  quando a entidade suporta soft delete; para order_items o delete é físico). */
function remoteDeleteById(id: string): Record<string, unknown> {
  return { id };
}

/**
 * Enfileira uma mutação para o motor de sync.
 * Toda escrita no banco deve chamar isto (idealmente dentro da mesma transação).
 */
async function enqueue(
  db: SQLite.SQLiteDatabase,
  entity: SyncEntity,
  entityId: string,
  op: SyncOp,
  payload: unknown,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO sync_queue (entity, entity_id, op, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
    entity,
    entityId,
    op,
    JSON.stringify(payload ?? null),
    Date.now(),
  );
}

/** Lê os itens pendentes na fila de sincronização (mais antigos primeiro). */
export async function getSyncQueue(limit = 200): Promise<SyncQueueItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    entity: string;
    entity_id: string;
    op: string;
    payload_json: string;
    created_at: number;
  }>(
    'SELECT id, entity, entity_id, op, payload_json, created_at FROM sync_queue ORDER BY id ASC LIMIT ?',
    limit,
  );
  return rows.map((r) => {
    let payload: unknown = null;
    try {
      payload = JSON.parse(r.payload_json);
    } catch {
      payload = null;
    }
    return {
      id: r.id,
      entity: r.entity as SyncEntity,
      entityId: r.entity_id,
      op: r.op as SyncOp,
      payload,
      createdAt: r.created_at,
    };
  });
}

/** Remove um item já sincronizado da fila. */
export async function removeSyncQueueItem(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM sync_queue WHERE id = ?', id);
}

/** Remove vários itens já sincronizados da fila (numa transação). */
export async function removeSyncQueueItems(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      await db.runAsync('DELETE FROM sync_queue WHERE id = ?', id);
    }
  });
}

// ---------------------------------------------------------------------------
// Aplicação de linha remota vinda do Realtime (LWW, SEM reenfileirar)
// ---------------------------------------------------------------------------

/**
 * Entidades que podem chegar do Supabase Realtime.
 * Mesmos valores/nomes de tabela de `SyncEntity` (reuso do alias).
 */
export type RemoteEntity = SyncEntity;

/**
 * Normaliza um valor booleano vindo do Realtime para 0/1 (SQLite).
 * O Postgres pode mandar `true`/`false`, `1`/`0`, ou `'t'`/`'f'` dependendo do
 * transporte. Trata todos os casos e cai para o `fallback` se vier nulo/undefined.
 */
function toBit(v: unknown, fallback = 0): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v === 0 ? 0 : 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === 't' || s === '1') return 1;
    if (s === 'false' || s === 'f' || s === '0' || s === '') return 0;
  }
  return v ? 1 : 0;
}

/** Coerção segura para number (com fallback). */
function toNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Coerção segura para string (com fallback). */
function toStr(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return fallback;
  return String(v);
}

/**
 * Lê o `updated_at` local de uma linha (por id) na tabela informada.
 * Retorna null se a linha ainda não existe localmente.
 */
async function getLocalUpdatedAt(
  db: SQLite.SQLiteDatabase,
  table: 'sections' | 'products' | 'tables',
  id: string,
): Promise<number | null> {
  const row = await db.getFirstAsync<{ updated_at: number }>(
    `SELECT updated_at FROM ${table} WHERE id = ?`,
    id,
  );
  return row ? row.updated_at : null;
}

/**
 * Aplica no SQLite LOCAL uma linha vinda do Supabase Realtime (formato REMOTO,
 * snake_case) usando LAST-WRITE-WINS por `updated_at`.
 *
 * REGRAS IMPORTANTES:
 * - NÃO chama `enqueue()`: isto é a aplicação de uma mudança já ocorrida no
 *   remoto; reenfileirar geraria um loop de push. Escreve direto via runAsync.
 * - LWW: se a linha local já existe e seu `updated_at` >= o remoto, IGNORA
 *   (torna idempotente o eco da própria escrita do aparelho). `order_items`
 *   não têm `updated_at` confiável próprio na tabela local, então são sempre
 *   aplicados (seguem a mesa; o upsert é idempotente por id).
 * - Deletes lógicos (row.deleted verdadeiro) apenas marcam `deleted = 1`
 *   localmente — a UI filtra `deleted = 0`.
 *
 * Idempotente e defensivo: campos ausentes caem em defaults; nunca lança por
 * causa de tipo/valor inesperado do payload remoto.
 */
export async function applyRemoteRow(
  entity: RemoteEntity,
  row: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  const id = toStr(row.id);
  if (!id) return; // sem id não há o que aplicar

  switch (entity) {
    case 'sections': {
      const remoteUpdatedAt = toNum(row.updated_at);
      const localUpdatedAt = await getLocalUpdatedAt(db, 'sections', id);
      // LWW: local mais novo ou igual => ignora.
      if (localUpdatedAt !== null && localUpdatedAt >= remoteUpdatedAt) return;
      await db.runAsync(
        `INSERT INTO sections (id, label, position, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           position = excluded.position,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted`,
        id,
        toStr(row.label),
        toNum(row.position),
        remoteUpdatedAt,
        toBit(row.deleted),
      );
      return;
    }

    case 'products': {
      const remoteUpdatedAt = toNum(row.updated_at);
      const localUpdatedAt = await getLocalUpdatedAt(db, 'products', id);
      if (localUpdatedAt !== null && localUpdatedAt >= remoteUpdatedAt) return;
      await db.runAsync(
        `INSERT INTO products (id, section_id, name, price, icon, image_url, available, position, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           section_id = excluded.section_id,
           name = excluded.name,
           price = excluded.price,
           icon = excluded.icon,
           image_url = excluded.image_url,
           available = excluded.available,
           position = excluded.position,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted`,
        id,
        toStr(row.section_id),
        toStr(row.name),
        toNum(row.price),
        toStr(row.icon),
        toStr(row.image_url),
        toBit(row.available, 1),
        toNum(row.position),
        remoteUpdatedAt,
        toBit(row.deleted),
      );
      return;
    }

    case 'tables': {
      const remoteUpdatedAt = toNum(row.updated_at);
      const localUpdatedAt = await getLocalUpdatedAt(db, 'tables', id);
      if (localUpdatedAt !== null && localUpdatedAt >= remoteUpdatedAt) return;
      const status = toStr(row.status) === 'ocupada' ? 'ocupada' : 'livre';
      await db.runAsync(
        `INSERT INTO tables (id, num, name, status, opened_at, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           num = excluded.num,
           name = excluded.name,
           status = excluded.status,
           opened_at = excluded.opened_at,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted`,
        id,
        toStr(row.num),
        toStr(row.name),
        status,
        toNum(row.opened_at),
        remoteUpdatedAt,
        toBit(row.deleted),
      );
      return;
    }

    case 'order_items': {
      // A tabela local order_items NÃO tem updated_at próprio; segue a mesa.
      // Aplica direto (idempotente por id). Deletes vêm com deleted=true no row:
      // como a tabela local não guarda a coluna deleted, um delete lógico remoto
      // vira DELETE físico local (a mesa/itens são recarregados pela UI).
      if (toBit(row.deleted) === 1) {
        await db.runAsync('DELETE FROM order_items WHERE id = ?', id);
        return;
      }
      await db.runAsync(
        `INSERT INTO order_items (id, table_id, product_id, name, price, qty)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           table_id = excluded.table_id,
           product_id = excluded.product_id,
           name = excluded.name,
           price = excluded.price,
           qty = excluded.qty`,
        id,
        toStr(row.table_id),
        toStr(row.product_id),
        toStr(row.name),
        toNum(row.price),
        toNum(row.qty),
      );
      return;
    }

    case 'sales': {
      // sales não têm updated_at; são imutáveis após fechadas. Upsert por id é
      // idempotente. items_json pode vir como string (JSON) ou já como objeto.
      let itemsJson: string;
      const rawItems = row.items_json;
      if (typeof rawItems === 'string') {
        itemsJson = rawItems;
      } else if (rawItems === undefined || rawItems === null) {
        itemsJson = '[]';
      } else {
        try {
          itemsJson = JSON.stringify(rawItems);
        } catch {
          itemsJson = '[]';
        }
      }
      await db.runAsync(
        `INSERT INTO sales (id, table_id, table_name, items_json, total, payment, closed_at, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           table_id = excluded.table_id,
           table_name = excluded.table_name,
           items_json = excluded.items_json,
           total = excluded.total,
           payment = excluded.payment,
           closed_at = excluded.closed_at,
           synced = excluded.synced`,
        id,
        toStr(row.table_id),
        toStr(row.table_name),
        itemsJson,
        toNum(row.total),
        toStr(row.payment),
        toNum(row.closed_at),
        // Linha veio do remoto => considera-se sincronizada localmente.
        toBit(row.synced, 1),
      );
      return;
    }

    default: {
      // Exaustividade: se um novo RemoteEntity for adicionado sem tratamento,
      // o TypeScript acusa aqui.
      const _exhaustive: never = entity;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Meta (chave/valor) — sequência de mesas, flags, etc.
// ---------------------------------------------------------------------------

/** Lê um valor da tabela `meta` (ou null se não existir). */
export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    key,
  );
  return row ? row.value : null;
}

/** Grava um valor na tabela `meta` (upsert). */
export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

// ---------------------------------------------------------------------------
// Migrations + init + seed
// ---------------------------------------------------------------------------

const MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY NOT NULL,
  section_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  icon TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  available INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY NOT NULL,
  num TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'livre',
  opened_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY NOT NULL,
  table_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY NOT NULL,
  table_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  items_json TEXT NOT NULL,
  total REAL NOT NULL DEFAULT 0,
  payment TEXT NOT NULL,
  closed_at INTEGER NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_section ON products (section_id);
CREATE INDEX IF NOT EXISTS idx_order_items_table ON order_items (table_id);
CREATE INDEX IF NOT EXISTS idx_sales_closed_at ON sales (closed_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue (created_at);
`;

/**
 * Abre/cria o banco, ativa WAL, roda migrations idempotentes e popula o seed
 * na primeira execução. Idempotente e seguro para chamadas concorrentes
 * (compartilha uma única promessa de inicialização).
 */
/**
 * Migrations de coluna idempotentes para bancos já existentes.
 * O SQLite não tem "ADD COLUMN IF NOT EXISTS", então checamos o schema atual
 * (PRAGMA table_info) e adicionamos apenas as colunas que faltam.
 */
async function ensureColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info('products')",
  );
  const hasImageUrl = cols.some((c) => c.name === 'image_url');
  if (!hasImageUrl) {
    await db.execAsync(
      "ALTER TABLE products ADD COLUMN image_url TEXT NOT NULL DEFAULT ''",
    );
  }
}

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    // WAL melhora concorrência leitura/escrita; foreign_keys off (soft-delete lógico).
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync(MIGRATIONS_SQL);
    await ensureColumns(db);
    dbInstance = db;
    await seedIfEmpty();
    return db;
  })();

  try {
    return await initPromise;
  } catch (err) {
    // Permite nova tentativa caso a inicialização falhe.
    initPromise = null;
    throw err;
  }
}

/**
 * Popula o cardápio inicial (seções + produtos) se ainda não houver nenhuma
 * seção não-deletada. Roda numa transação e marca a flag em `meta`.
 */
export async function seedIfEmpty(): Promise<void> {
  const db = await getDb();

  const alreadySeeded = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    'seeded',
  );
  if (alreadySeeded && alreadySeeded.value === '1') return;

  const existing = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) AS c FROM sections WHERE deleted = 0',
  );
  if (existing && existing.c > 0) {
    await setMeta('seeded', '1');
    return;
  }

  const now = Date.now();
  const { sections, products } = buildSeedRows(now);

  await db.withTransactionAsync(async () => {
    for (const s of sections) {
      const res = await db.runAsync(
        'INSERT OR IGNORE INTO sections (id, label, position, updated_at, deleted) VALUES (?, ?, ?, ?, 0)',
        s.id,
        s.label,
        s.position,
        s.updatedAt,
      );
      // Só enfileira se a linha foi realmente inserida (evita duplicar na fila
      // caso o seed reexecute após um crash antes de gravar a flag `seeded`).
      if (res.changes > 0) await enqueue(db, 'sections', s.id, 'upsert', remoteSection(s));
    }
    for (const p of products) {
      const res = await db.runAsync(
        'INSERT OR IGNORE INTO products (id, section_id, name, price, icon, available, position, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
        p.id,
        p.sectionId,
        p.name,
        p.price,
        p.icon,
        p.available ? 1 : 0,
        p.position,
        p.updatedAt,
      );
      if (res.changes > 0) await enqueue(db, 'products', p.id, 'upsert', remoteProduct(p));
    }
    await db.runAsync(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'seeded',
      '1',
    );
  });
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** Retorna as seções ativas ordenadas por posição. */
export async function getSections(): Promise<Section[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SectionRow>(
    'SELECT id, label, position, updated_at, deleted FROM sections WHERE deleted = 0 ORDER BY position ASC, label ASC',
  );
  return rows.map(mapSection);
}

/** Cria uma nova seção no fim da lista. Retorna a seção criada. */
export async function addSection(label: string): Promise<Section> {
  const db = await getDb();
  const id = nanoid();
  const now = Date.now();

  const posRow = await db.getFirstAsync<{ maxPos: number | null }>(
    'SELECT MAX(position) AS maxPos FROM sections WHERE deleted = 0',
  );
  const position = (posRow?.maxPos ?? -1) + 1;

  const section: Section = {
    id,
    label: label.trim(),
    position,
    updatedAt: now,
    deleted: false,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO sections (id, label, position, updated_at, deleted) VALUES (?, ?, ?, ?, 0)',
      section.id,
      section.label,
      section.position,
      section.updatedAt,
    );
    await enqueue(db, 'sections', section.id, 'upsert', remoteSection(section));
  });

  return section;
}

/** Renomeia uma seção. Retorna a seção atualizada (ou null se não existir). */
export async function renameSection(
  id: string,
  label: string,
): Promise<Section | null> {
  const db = await getDb();
  const now = Date.now();
  const trimmed = label.trim();

  let updated: Section | null = null;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE sections SET label = ?, updated_at = ? WHERE id = ?',
      trimmed,
      now,
      id,
    );
    const row = await db.getFirstAsync<SectionRow>(
      'SELECT id, label, position, updated_at, deleted FROM sections WHERE id = ?',
      id,
    );
    if (row) {
      updated = mapSection(row);
      await enqueue(db, 'sections', id, 'upsert', remoteSection(updated));
    }
  });
  return updated;
}

/**
 * Remove (soft delete) uma seção. Os PRODUTOS NÃO são apagados: eles são apenas
 * DESVINCULADOS (section_id = ''), continuando salvos no banco e aparecendo em
 * "Todos os produtos" como "Sem seção". A hierarquia é Produto → Seção: excluir a
 * seção só rompe o vínculo, nunca destrói os produtos.
 */
export async function removeSection(id: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    // Lê a linha ANTES de marcar deletada, para enviar ao remoto a linha completa
    // com deleted=1 (upsert LWW) — evita violar NOT NULL das colunas do Supabase.
    const secRow = await db.getFirstAsync<SectionRow>(
      'SELECT id, label, position, updated_at, deleted FROM sections WHERE id = ?',
      id,
    );
    await db.runAsync(
      'UPDATE sections SET deleted = 1, updated_at = ? WHERE id = ?',
      now,
      id,
    );
    if (secRow) {
      const deletedSec = { ...mapSection(secRow), updatedAt: now, deleted: true };
      await enqueue(db, 'sections', id, 'delete', remoteSection(deletedSec));
    }

    // DESVINCULA os produtos (mantém-nos vivos, só remove a categoria).
    const products = await db.getAllAsync<ProductRow>(
      'SELECT id, section_id, name, price, icon, image_url, available, position, updated_at, deleted FROM products WHERE section_id = ? AND deleted = 0',
      id,
    );
    for (const p of products) {
      await db.runAsync(
        "UPDATE products SET section_id = '', updated_at = ? WHERE id = ?",
        now,
        p.id,
      );
      const unlinked = { ...mapProduct(p), sectionId: '', updatedAt: now };
      await enqueue(db, 'products', p.id, 'upsert', remoteProduct(unlinked));
    }
  });
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/** Retorna todos os produtos ativos ordenados por seção e posição. */
export async function getProducts(): Promise<Product[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ProductRow>(
    'SELECT id, section_id, name, price, icon, image_url, available, position, updated_at, deleted FROM products WHERE deleted = 0 ORDER BY section_id ASC, position ASC, name ASC',
  );
  return rows.map(mapProduct);
}

/** Retorna os produtos ativos de uma seção, ordenados por posição. */
export async function getProductsBySection(
  sectionId: string,
): Promise<Product[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ProductRow>(
    'SELECT id, section_id, name, price, icon, image_url, available, position, updated_at, deleted FROM products WHERE section_id = ? AND deleted = 0 ORDER BY position ASC, name ASC',
    sectionId,
  );
  return rows.map(mapProduct);
}

/**
 * Cria um produto. Aceita um objeto parcial: id/position/updatedAt/available
 * são preenchidos automaticamente quando omitidos. Retorna o produto criado.
 */
export async function addProduct(
  p: {
    sectionId: string;
    name: string;
    price: number;
    icon?: string;
    imageUrl?: string;
    available?: boolean;
    position?: number;
    id?: string;
  },
): Promise<Product> {
  const db = await getDb();
  const now = Date.now();
  const id = p.id ?? nanoid();

  let position = p.position;
  if (position === undefined) {
    const posRow = await db.getFirstAsync<{ maxPos: number | null }>(
      'SELECT MAX(position) AS maxPos FROM products WHERE section_id = ? AND deleted = 0',
      p.sectionId,
    );
    position = (posRow?.maxPos ?? -1) + 1;
  }

  const product: Product = {
    id,
    sectionId: p.sectionId,
    name: p.name.trim(),
    price: p.price,
    icon: p.icon ?? '',
    imageUrl: p.imageUrl ?? '',
    available: p.available ?? true,
    position,
    updatedAt: now,
    deleted: false,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO products (id, section_id, name, price, icon, image_url, available, position, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
      product.id,
      product.sectionId,
      product.name,
      product.price,
      product.icon,
      product.imageUrl,
      product.available ? 1 : 0,
      product.position,
      product.updatedAt,
    );
    await enqueue(db, 'products', product.id, 'upsert', remoteProduct(product));
  });

  return product;
}

/**
 * Atualiza um produto existente. Aceita objeto parcial com o `id` obrigatório;
 * mescla sobre a linha atual. Retorna o produto atualizado (ou null se sumiu).
 */
export async function updateProduct(
  p: Partial<Product> & { id: string },
): Promise<Product | null> {
  const db = await getDb();
  const now = Date.now();

  let updated: Product | null = null;
  await db.withTransactionAsync(async () => {
    const currentRow = await db.getFirstAsync<ProductRow>(
      'SELECT id, section_id, name, price, icon, image_url, available, position, updated_at, deleted FROM products WHERE id = ?',
      p.id,
    );
    if (!currentRow) return;

    const current = mapProduct(currentRow);
    const next: Product = {
      ...current,
      ...p,
      name: p.name !== undefined ? p.name.trim() : current.name,
      updatedAt: now,
    };

    await db.runAsync(
      'UPDATE products SET section_id = ?, name = ?, price = ?, icon = ?, image_url = ?, available = ?, position = ?, updated_at = ?, deleted = ? WHERE id = ?',
      next.sectionId,
      next.name,
      next.price,
      next.icon,
      next.imageUrl ?? '',
      next.available ? 1 : 0,
      next.position,
      next.updatedAt,
      next.deleted ? 1 : 0,
      next.id,
    );
    updated = next;
    await enqueue(db, 'products', next.id, 'upsert', remoteProduct(next));
  });

  return updated;
}

/** Remove (soft delete) um produto. */
export async function removeProduct(id: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<ProductRow>(
      'SELECT id, section_id, name, price, icon, image_url, available, position, updated_at, deleted FROM products WHERE id = ?',
      id,
    );
    await db.runAsync(
      'UPDATE products SET deleted = 1, updated_at = ? WHERE id = ?',
      now,
      id,
    );
    if (row) {
      const deletedProd = { ...mapProduct(row), updatedAt: now, deleted: true };
      await enqueue(db, 'products', id, 'delete', remoteProduct(deletedProd));
    }
  });
}

/**
 * Alterna a disponibilidade de um produto (esgotado <-> disponível).
 * Retorna o produto atualizado (ou null se não existir).
 */
export async function toggleAvailable(id: string): Promise<Product | null> {
  const db = await getDb();
  const now = Date.now();

  let updated: Product | null = null;
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<ProductRow>(
      'SELECT id, section_id, name, price, icon, image_url, available, position, updated_at, deleted FROM products WHERE id = ?',
      id,
    );
    if (!row) return;

    const nextAvailable = row.available === 1 ? 0 : 1;
    await db.runAsync(
      'UPDATE products SET available = ?, updated_at = ? WHERE id = ?',
      nextAvailable,
      now,
      id,
    );
    updated = mapProduct({
      ...row,
      available: nextAvailable,
      updated_at: now,
    });
    await enqueue(db, 'products', id, 'upsert', remoteProduct(updated));
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Tables + Order items
// ---------------------------------------------------------------------------

/**
 * Retorna as mesas ativas com seus itens carregados (items: OrderItem[]).
 * Ordenadas por abertura (mais recentes primeiro).
 */
export async function getTables(): Promise<Table[]> {
  const db = await getDb();
  const tableRows = await db.getAllAsync<TableRow>(
    'SELECT id, num, name, status, opened_at, updated_at, deleted FROM tables WHERE deleted = 0 ORDER BY opened_at DESC, num ASC',
  );
  if (tableRows.length === 0) return [];

  const itemRows = await db.getAllAsync<OrderItemRow>(
    'SELECT id, table_id, product_id, name, price, qty FROM order_items ORDER BY rowid ASC',
  );

  const itemsByTable = new Map<string, OrderItem[]>();
  for (const row of itemRows) {
    const list = itemsByTable.get(row.table_id) ?? [];
    list.push(mapOrderItem(row));
    itemsByTable.set(row.table_id, list);
  }

  return tableRows.map((r) => mapTable(r, itemsByTable.get(r.id) ?? []));
}

/**
 * Retorna o próximo número sequencial de mesa (persistido em `meta`).
 * Formato "01", "02"... Avança o contador de forma atômica.
 */
export async function nextTableSeq(): Promise<string> {
  const db = await getDb();
  let seq = 1;

  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      'table_seq',
    );
    const current = row ? parseInt(row.value, 10) : 0;
    seq = (Number.isFinite(current) ? current : 0) + 1;
    await db.runAsync(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'table_seq',
      String(seq),
    );
  });

  return String(seq).padStart(2, '0');
}

/**
 * Abre uma nova mesa. Se `name` não for informado, usa "Mesa NN" com o próximo
 * número da sequência. Retorna a mesa criada (status 'ocupada', items vazios).
 */
export async function addTable(name?: string): Promise<Table> {
  const db = await getDb();
  const num = await nextTableSeq();
  const id = nanoid();
  const now = Date.now();
  const finalName = name && name.trim().length > 0 ? name.trim() : `Mesa ${num}`;

  const table: Table = {
    id,
    num,
    name: finalName,
    status: 'ocupada',
    items: [],
    openedAt: now,
    updatedAt: now,
    deleted: false,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO tables (id, num, name, status, opened_at, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?, 0)',
      table.id,
      table.num,
      table.name,
      table.status,
      table.openedAt,
      table.updatedAt,
    );
    await enqueue(db, 'tables', table.id, 'upsert', remoteTable(table));
  });

  return table;
}

/** Renomeia uma mesa. Retorna a mesa atualizada (com itens) ou null. */
export async function renameTable(
  id: string,
  name: string,
): Promise<Table | null> {
  const db = await getDb();
  const now = Date.now();
  const trimmed = name.trim();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE tables SET name = ?, updated_at = ? WHERE id = ?',
      trimmed,
      now,
      id,
    );
    const row = await db.getFirstAsync<TableRow>(
      'SELECT id, num, name, status, opened_at, updated_at, deleted FROM tables WHERE id = ?',
      id,
    );
    if (row) {
      await enqueue(db, 'tables', id, 'upsert', remoteTable(mapTable(row, [])));
    }
  });

  return findTable(id);
}

/**
 * Remove (soft delete) uma mesa e apaga seus itens.
 * Usado quando a mesa é fechada/cancelada sem virar venda.
 */
export async function removeTable(id: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    // Enfileira exclusão dos itens antes de apagá-los (linha completa p/ o remoto).
    const items = await db.getAllAsync<OrderItemRow>(
      'SELECT id, table_id, product_id, name, price, qty FROM order_items WHERE table_id = ?',
      id,
    );
    for (const it of items) {
      await enqueue(db, 'order_items', it.id, 'delete', remoteOrderItem(id, mapOrderItem(it), true));
    }
    await db.runAsync('DELETE FROM order_items WHERE table_id = ?', id);

    const tblRow = await db.getFirstAsync<TableRow>(
      'SELECT id, num, name, status, opened_at, updated_at, deleted FROM tables WHERE id = ?',
      id,
    );
    await db.runAsync(
      'UPDATE tables SET deleted = 1, status = ?, updated_at = ? WHERE id = ?',
      'livre',
      now,
      id,
    );
    if (tblRow) {
      const deletedTbl = {
        ...mapTable(tblRow, []),
        status: 'livre' as const,
        updatedAt: now,
        deleted: true,
      };
      await enqueue(db, 'tables', id, 'delete', remoteTable(deletedTbl));
    }
  });
}

/**
 * Adiciona 1 unidade de um produto à mesa. Se o item já existir na comanda,
 * incrementa a quantidade. Retorna a mesa atualizada (com itens).
 */
export async function addItemToTable(
  tableId: string,
  product: Pick<Product, 'id' | 'name' | 'price'>,
): Promise<Table | null> {
  const db = await getDb();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<OrderItemRow>(
      'SELECT id, table_id, product_id, name, price, qty FROM order_items WHERE table_id = ? AND product_id = ?',
      tableId,
      product.id,
    );

    let item: OrderItem;
    if (existing) {
      const nextQty = existing.qty + 1;
      await db.runAsync(
        'UPDATE order_items SET qty = ? WHERE id = ?',
        nextQty,
        existing.id,
      );
      item = mapOrderItem({ ...existing, qty: nextQty });
    } else {
      const id = nanoid();
      await db.runAsync(
        'INSERT INTO order_items (id, table_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        tableId,
        product.id,
        product.name,
        product.price,
        1,
      );
      item = {
        id,
        productId: product.id,
        name: product.name,
        price: product.price,
        qty: 1,
      };
    }

    // A mesa passa a estar ocupada ao receber itens.
    await db.runAsync(
      'UPDATE tables SET status = ?, updated_at = ? WHERE id = ?',
      'ocupada',
      now,
      tableId,
    );

    await enqueue(db, 'order_items', item.id, 'upsert', remoteOrderItem(tableId, item));
  });

  return findTable(tableId);
}

/**
 * Define a quantidade de um item da comanda. Se `qty <= 0`, remove o item.
 * Retorna a mesa atualizada (com itens).
 */
export async function setItemQty(
  tableId: string,
  itemId: string,
  qty: number,
): Promise<Table | null> {
  const db = await getDb();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    if (qty <= 0) {
      // Lê a linha antes de apagar para enfileirar o delete com dados completos.
      const row = await db.getFirstAsync<OrderItemRow>(
        'SELECT id, table_id, product_id, name, price, qty FROM order_items WHERE id = ? AND table_id = ?',
        itemId,
        tableId,
      );
      await db.runAsync(
        'DELETE FROM order_items WHERE id = ? AND table_id = ?',
        itemId,
        tableId,
      );
      if (row) {
        await enqueue(db, 'order_items', itemId, 'delete', remoteOrderItem(tableId, mapOrderItem(row), true));
      }
    } else {
      await db.runAsync(
        'UPDATE order_items SET qty = ? WHERE id = ? AND table_id = ?',
        qty,
        itemId,
        tableId,
      );
      const row = await db.getFirstAsync<OrderItemRow>(
        'SELECT id, table_id, product_id, name, price, qty FROM order_items WHERE id = ?',
        itemId,
      );
      if (row) {
        await enqueue(db, 'order_items', itemId, 'upsert', remoteOrderItem(tableId, mapOrderItem(row)));
      }
    }
    await db.runAsync(
      'UPDATE tables SET updated_at = ? WHERE id = ?',
      now,
      tableId,
    );
  });

  return findTable(tableId);
}

/** Remove todos os itens de uma mesa (esvazia a comanda). */
export async function clearTableItems(tableId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    const items = await db.getAllAsync<OrderItemRow>(
      'SELECT id, table_id, product_id, name, price, qty FROM order_items WHERE table_id = ?',
      tableId,
    );
    for (const it of items) {
      await enqueue(db, 'order_items', it.id, 'delete', remoteOrderItem(tableId, mapOrderItem(it), true));
    }
    await db.runAsync('DELETE FROM order_items WHERE table_id = ?', tableId);
    await db.runAsync(
      'UPDATE tables SET updated_at = ? WHERE id = ?',
      now,
      tableId,
    );
  });
}

/**
 * Busca uma única mesa (com itens) pelo id, ou null.
 * Versão pública — útil para o realtime recarregar apenas a mesa afetada.
 * NÃO filtra por `deleted`: o chamador decide (a UI normalmente ignora deletadas).
 */
export async function getTableById(id: string): Promise<Table | null> {
  return findTable(id);
}

/** Busca uma única mesa (com itens) pelo id, ou null. Uso interno/retorno. */
async function findTable(id: string): Promise<Table | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<TableRow>(
    'SELECT id, num, name, status, opened_at, updated_at, deleted FROM tables WHERE id = ?',
    id,
  );
  if (!row) return null;
  const itemRows = await db.getAllAsync<OrderItemRow>(
    'SELECT id, table_id, product_id, name, price, qty FROM order_items WHERE table_id = ? ORDER BY rowid ASC',
    id,
  );
  return mapTable(row, itemRows.map(mapOrderItem));
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

/**
 * Registra uma venda finalizada. Preenche id/closedAt quando omitidos.
 * Grava o snapshot dos itens em JSON e enfileira para sync.
 * NÃO mexe na mesa — a tela deve chamar clearTableItems/removeTable conforme o fluxo.
 * Retorna a venda registrada.
 */
export async function recordSale(
  sale: {
    tableId: string;
    tableName: string;
    items: OrderItem[];
    total: number;
    payment: PaymentMethod;
    id?: string;
    closedAt?: number;
    synced?: boolean;
  },
): Promise<Sale> {
  const db = await getDb();
  const id = sale.id ?? nanoid();
  const closedAt = sale.closedAt ?? Date.now();

  const record: Sale = {
    id,
    tableId: sale.tableId,
    tableName: sale.tableName,
    items: sale.items,
    total: sale.total,
    payment: sale.payment,
    closedAt,
    synced: sale.synced ?? false,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO sales (id, table_id, table_name, items_json, total, payment, closed_at, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      record.id,
      record.tableId,
      record.tableName,
      JSON.stringify(record.items),
      record.total,
      record.payment,
      record.closedAt,
      record.synced ? 1 : 0,
    );
    await enqueue(db, 'sales', record.id, 'upsert', remoteSale(record));
  });

  return record;
}

/** Retorna as vendas de hoje (00:00 até agora), mais recentes primeiro. */
export async function getSalesToday(): Promise<Sale[]> {
  const db = await getDb();
  const { start, end } = todayRange();
  const rows = await db.getAllAsync<SaleRow>(
    'SELECT id, table_id, table_name, items_json, total, payment, closed_at, synced FROM sales WHERE closed_at >= ? AND closed_at < ? ORDER BY closed_at DESC',
    start,
    end,
  );
  return rows.map(mapSale);
}

/** Retorna o total (R$) vendido hoje. */
export async function getSalesTodayTotal(): Promise<number> {
  const db = await getDb();
  const { start, end } = todayRange();
  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(total) AS total FROM sales WHERE closed_at >= ? AND closed_at < ?',
    start,
    end,
  );
  return row?.total ?? 0;
}

/** Marca uma venda como já sincronizada (usado pelo motor de sync). */
export async function markSaleSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE sales SET synced = 1 WHERE id = ?', id);
}

/** Intervalo [início do dia, início do dia seguinte) em ms, hora local. */
function todayRange(): { start: number; end: number } {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Relatório de vendas (agregações por período)
// ---------------------------------------------------------------------------

/** Todas as formas de pagamento suportadas (usado p/ inicializar quebras). */
const PAYMENT_METHODS: PaymentMethod[] = ['dinheiro', 'pix', 'debito', 'credito'];

/** Cria um objeto de quebra por pagamento zerado (todas as formas presentes). */
function emptyByPayment(): Record<PaymentMethod, { total: number; count: number }> {
  return {
    dinheiro: { total: 0, count: 0 },
    pix: { total: 0, count: 0 },
    debito: { total: 0, count: 0 },
    credito: { total: 0, count: 0 },
  };
}

/**
 * Vendas fechadas no intervalo [startMs, endMs), mais recentes primeiro.
 * Mesmo padrão de `getSalesToday`, mas com o intervalo parametrizado — serve de
 * base para os relatórios (resumo e top produtos leem daqui quando preciso).
 */
export async function getSalesBetween(
  startMs: number,
  endMs: number,
): Promise<Sale[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SaleRow>(
    'SELECT id, table_id, table_name, items_json, total, payment, closed_at, synced FROM sales WHERE closed_at >= ? AND closed_at < ? ORDER BY closed_at DESC',
    startMs,
    endMs,
  );
  return rows.map(mapSale);
}

/**
 * Resumo agregado do período: total vendido, número de vendas e quebra por
 * forma de pagamento. Feito em SQL (SUM/COUNT/GROUP BY payment) — eficiente e
 * sem carregar os itens_json. As quatro formas de pagamento sempre vêm presentes
 * na quebra (zeradas quando não houve venda naquela forma).
 */
export async function getSalesSummary(
  startMs: number,
  endMs: number,
): Promise<{
  total: number;
  count: number;
  byPayment: Record<PaymentMethod, { total: number; count: number }>;
}> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    payment: string;
    total: number | null;
    count: number;
  }>(
    'SELECT payment, SUM(total) AS total, COUNT(*) AS count FROM sales WHERE closed_at >= ? AND closed_at < ? GROUP BY payment',
    startMs,
    endMs,
  );

  const byPayment = emptyByPayment();
  let total = 0;
  let count = 0;

  for (const r of rows) {
    const rowTotal = r.total ?? 0;
    total += rowTotal;
    count += r.count;
    // Ignora eventuais valores de payment fora do enum (dado corrompido/legado).
    if (PAYMENT_METHODS.includes(r.payment as PaymentMethod)) {
      const bucket = byPayment[r.payment as PaymentMethod];
      bucket.total += rowTotal;
      bucket.count += r.count;
    }
  }

  return { total, count, byPayment };
}

/**
 * Produtos mais vendidos no período. Os itens ficam em `items_json` (snapshot),
 * então lemos as vendas do intervalo e agregamos em JS por NOME do produto:
 * somamos a quantidade e o faturamento (qty * price). Ordenado por qty desc
 * (empate desfeito por total desc) e limitado a `limit`.
 */
export async function getTopProducts(
  startMs: number,
  endMs: number,
  limit = 10,
): Promise<Array<{ name: string; qty: number; total: number }>> {
  const sales = await getSalesBetween(startMs, endMs);

  const acc = new Map<string, { name: string; qty: number; total: number }>();
  for (const sale of sales) {
    for (const it of sale.items) {
      const entry = acc.get(it.name) ?? { name: it.name, qty: 0, total: 0 };
      entry.qty += it.qty;
      entry.total += it.qty * it.price;
      acc.set(it.name, entry);
    }
  }

  const list = Array.from(acc.values());
  list.sort((a, b) => (b.qty - a.qty) || (b.total - a.total));
  return limit > 0 ? list.slice(0, limit) : list;
}

// ---------------------------------------------------------------------------
// Helpers de intervalo (hora local) — reutilizam o padrão de todayRange()
// ---------------------------------------------------------------------------

/**
 * Intervalo [00:00, 24:00) de um dia, deslocado por `offsetDays` a partir de hoje.
 * offsetDays=0 => hoje; -1 => ontem; +1 => amanhã. Retorno em ms (hora local).
 */
export function dayRange(offsetDays = 0): { start: number; end: number } {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + offsetDays,
    0,
    0,
    0,
    0,
  ).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return { start, end };
}

/**
 * Intervalo dos últimos 7 dias: [início de 6 dias atrás, início de amanhã).
 * Inclui hoje + os 6 dias anteriores (janela de 7 dias completa). Hora local.
 */
export function weekRange(): { start: number; end: number } {
  const { start } = dayRange(-6);
  const { end } = dayRange(0);
  return { start, end };
}

/**
 * Intervalo do mês corrente: [00:00 do dia 1, 00:00 do dia 1 do mês seguinte).
 * Hora local, em ms.
 */
export function monthRange(): { start: number; end: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
  return { start, end };
}

// ---------------------------------------------------------------------------
// Utilidades de manutenção
// ---------------------------------------------------------------------------

/**
 * Recarrega TODO o estado persistido do banco local, numa única chamada.
 * Conveniência para o store repopular a memória após aplicar mudanças remotas
 * do Realtime (as leituras já filtram `deleted = 0`). Não altera nada, só lê.
 */
export async function reloadAllFromLocal(): Promise<{
  sections: Section[];
  products: Product[];
  tables: Table[];
  salesTodayTotal: number;
}> {
  const [sections, products, tables, salesTodayTotal] = await Promise.all([
    getSections(),
    getProducts(),
    getTables(),
    getSalesTodayTotal(),
  ]);
  return { sections, products, tables, salesTodayTotal };
}

/** Fecha a conexão (útil em testes / hot reload). */
export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.closeAsync();
    dbInstance = null;
    initPromise = null;
  }
}
