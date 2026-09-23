-- ============================================================================
-- PDV Canto da Sorte — Schema Supabase (backup em nuvem do SQLite local)
-- ============================================================================
-- Este script espelha o schema local (SQLite) usado pelo app offline-first.
-- O app grava sempre primeiro no SQLite do aparelho e, quando há internet,
-- sincroniza (upsert) estas tabelas via fila de operações (src/sync/).
--
-- Convenções:
--  - Todas as PKs são texto (uuid/nanoid gerado no próprio app, não serial).
--  - Todas as tabelas têm updated_at (timestamptz) usado para last-write-wins
--    (LWW) no pull incremental e para os índices de sincronização.
--  - "deleted" é soft-delete: o motor de sync do app trata remoções como um
--    upsert do próprio registro com deleted = true, preservando histórico.
--  - Rode este arquivo inteiro no SQL Editor do Supabase (aba "SQL Editor" >
--    "New query" > colar > "Run"). Pode ser executado mais de uma vez com
--    segurança (usa IF NOT EXISTS / CREATE OR REPLACE onde aplicável).
-- ============================================================================


-- Extensão usada só se algum dia quisermos gerar uuid no próprio Postgres.
-- Não é obrigatória (os IDs já chegam prontos do app), mas não atrapalha.
create extension if not exists "pgcrypto";


-- ============================================================================
-- 1) SECTIONS — seções do cardápio (ex.: "Chopp & Cerveja", "Porções")
-- ============================================================================
create table if not exists public.sections (
  id text primary key,                          -- id gerado no app (nanoid)
  label text not null,                           -- nome da seção
  position integer not null default 0,           -- ordem de exibição nas abas
  deleted boolean not null default false,        -- soft-delete
  updated_at bigint not null default 0           -- epoch ms; usado no LWW / pull incremental
);

comment on table public.sections is 'Seções do cardápio (categorias de produtos) do bar Canto da Sorte.';
comment on column public.sections.id is 'Identificador único gerado no app (nanoid), replicado do SQLite local.';
comment on column public.sections.position is 'Posição/ordem de exibição das abas de categoria no PDV.';
comment on column public.sections.deleted is 'Soft-delete: true quando a seção foi removida no app.';
comment on column public.sections.updated_at is 'Timestamp da última alteração; base do last-write-wins na sincronização.';

create index if not exists sections_updated_at_idx on public.sections (updated_at);


-- ============================================================================
-- 2) PRODUCTS — produtos do cardápio
-- ============================================================================
create table if not exists public.products (
  id text primary key,
  section_id text not null references public.sections (id),
  name text not null,
  price numeric(10, 2) not null default 0,
  icon text not null default '',                 -- emoji ou vazio (usa inicial do nome na UI)
  available boolean not null default true,        -- false = "Esgotado" no PDV
  position integer not null default 0,            -- ordem dentro da seção
  deleted boolean not null default false,
  updated_at bigint not null default 0            -- epoch ms
);

comment on table public.products is 'Produtos vendidos no bar, agrupados por seção do cardápio.';
comment on column public.products.section_id is 'Seção (categoria) à qual o produto pertence.';
comment on column public.products.price is 'Preço unitário em reais (2 casas decimais).';
comment on column public.products.icon is 'Emoji de ícone do produto, ou vazio para usar a inicial do nome.';
comment on column public.products.available is 'Disponibilidade do produto; indisponível aparece com selo "Esgotado".';
comment on column public.products.position is 'Posição/ordem de exibição do produto dentro da sua seção.';
comment on column public.products.deleted is 'Soft-delete: true quando o produto foi removido no app.';
comment on column public.products.updated_at is 'Timestamp da última alteração; base do last-write-wins na sincronização.';

create index if not exists products_updated_at_idx on public.products (updated_at);
create index if not exists products_section_id_idx on public.products (section_id);


-- ============================================================================
-- 3) TABLES — mesas/comandas (estado atual de cada mesa aberta)
-- ============================================================================
create table if not exists public.tables (
  id text primary key,
  num text not null,                              -- "01", "02"...
  name text not null,                              -- "Mesa 01" ou nome customizado
  status text not null default 'livre',            -- 'livre' | 'ocupada'
  opened_at bigint,                                 -- epoch ms de quando a mesa foi aberta
  deleted boolean not null default false,
  updated_at bigint not null default 0,            -- epoch ms
  constraint tables_status_check check (status in ('livre', 'ocupada'))
);

comment on table public.tables is 'Mesas do salão e o estado atual da comanda (itens lançados) de cada uma.';
comment on column public.tables.num is 'Número/código curto da mesa exibido no card (ex.: "01").';
comment on column public.tables.status is 'Status atual da mesa: livre ou ocupada.';
comment on column public.tables.opened_at is 'Momento (epoch ms) em que a mesa foi aberta (ficou ocupada) pela última vez.';
comment on column public.tables.deleted is 'Soft-delete: true quando a mesa foi removida no app.';
comment on column public.tables.updated_at is 'Timestamp da última alteração; base do last-write-wins na sincronização.';

create index if not exists tables_updated_at_idx on public.tables (updated_at);
create index if not exists tables_status_idx on public.tables (status);


-- ============================================================================
-- 4) ORDER_ITEMS — histórico normalizado de itens lançados (auditoria)
-- ============================================================================
-- Observação: no app, os itens de uma comanda em aberto vivem embutidos em
-- `tables.items` (jsonb) para simplicidade e velocidade no SQLite local. Esta
-- tabela existe para quem quiser also manter um histórico normalizado/consultável
-- por item no Supabase (ex.: relatórios). O motor de sync (src/sync/) já
-- reconhece a entidade 'order_items' na fila, então basta o database.ts
-- enfileirar aqui se/quando for necessário granularidade por item.
create table if not exists public.order_items (
  id text primary key,
  table_id text references public.tables (id),
  product_id text references public.products (id),
  name text not null,                              -- snapshot do nome no momento do lançamento
  price numeric(10, 2) not null default 0,          -- snapshot do preço unitário
  qty integer not null default 1,
  deleted boolean not null default false,
  updated_at bigint not null default 0             -- epoch ms
);

comment on table public.order_items is 'Itens lançados em comandas (histórico normalizado, snapshot de nome/preço no momento do lançamento).';
comment on column public.order_items.table_id is 'Mesa/comanda à qual este item pertence.';
comment on column public.order_items.product_id is 'Produto de origem do item (referência informativa; nome/preço já estão em snapshot).';
comment on column public.order_items.name is 'Nome do produto no momento em que foi lançado (snapshot).';
comment on column public.order_items.price is 'Preço unitário no momento em que foi lançado (snapshot).';
comment on column public.order_items.qty is 'Quantidade lançada deste item.';
comment on column public.order_items.updated_at is 'Timestamp da última alteração; base do last-write-wins na sincronização.';

create index if not exists order_items_updated_at_idx on public.order_items (updated_at);
create index if not exists order_items_table_id_idx on public.order_items (table_id);


-- ============================================================================
-- 5) SALES — vendas finalizadas (histórico / relatório do dia)
-- ============================================================================
create table if not exists public.sales (
  id text primary key,
  table_id text not null,
  table_name text not null,
  items_json text not null default '[]',           -- snapshot dos itens da comanda (OrderItem[]) serializado (JSON string)
  total numeric(10, 2) not null default 0,
  payment text not null,                            -- 'dinheiro' | 'pix' | 'debito' | 'credito'
  closed_at bigint not null,                         -- epoch ms de quando a mesa foi finalizada/paga
  synced boolean not null default false,             -- flag de controle vinda do app
  updated_at timestamptz not null default now(),
  constraint sales_payment_check check (payment in ('dinheiro', 'pix', 'debito', 'credito'))
);

comment on table public.sales is 'Vendas finalizadas: registro histórico usado no relatório de "Vendas do dia".';
comment on column public.sales.table_id is 'Id da mesa que originou esta venda (mesa pode já ter sido reaberta/renomeada depois).';
comment on column public.sales.table_name is 'Nome da mesa no momento do fechamento (snapshot).';
comment on column public.sales.items is 'Itens da comanda no momento do fechamento, como array JSON (OrderItem[]).';
comment on column public.sales.total is 'Valor total da venda em reais.';
comment on column public.sales.payment is 'Forma de pagamento usada para fechar a mesa.';
comment on column public.sales.closed_at is 'Momento em que o pagamento foi confirmado e a mesa foi fechada.';
comment on column public.sales.updated_at is 'Timestamp da última alteração; base do last-write-wins na sincronização.';

create index if not exists sales_updated_at_idx on public.sales (updated_at);
create index if not exists sales_closed_at_idx on public.sales (closed_at);


-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
-- Habilitamos RLS em todas as tabelas por segurança básica. As policies abaixo
-- são PERMISSIVAS: qualquer usuário AUTENTICADO (chave anon + login, ou apenas
-- a anon key se o projeto não usar auth de usuário) pode ler/escrever tudo.
-- Isso é suficiente para um app interno de 2-3 aparelhos do próprio bar.
--
-- ATENÇÃO — EM PRODUÇÃO: se este projeto crescer (múltiplos bares, dados
-- sensíveis, etc.), refine estas policies para restringir por dono/tenant
-- (ex.: coluna owner_id + auth.uid() = owner_id), e considere não expor a
-- anon key publicamente sem autenticação real de usuário.
-- ============================================================================

alter table public.sections    enable row level security;
alter table public.products    enable row level security;
alter table public.tables      enable row level security;
alter table public.order_items enable row level security;
alter table public.sales       enable row level security;

-- SECTIONS
drop policy if exists "sections_select_authenticated" on public.sections;
create policy "sections_select_authenticated"
  on public.sections for select
  to authenticated
  using (true);

drop policy if exists "sections_write_authenticated" on public.sections;
create policy "sections_write_authenticated"
  on public.sections for all
  to authenticated
  using (true)
  with check (true);

-- PRODUCTS
drop policy if exists "products_select_authenticated" on public.products;
create policy "products_select_authenticated"
  on public.products for select
  to authenticated
  using (true);

drop policy if exists "products_write_authenticated" on public.products;
create policy "products_write_authenticated"
  on public.products for all
  to authenticated
  using (true)
  with check (true);

-- TABLES
drop policy if exists "tables_select_authenticated" on public.tables;
create policy "tables_select_authenticated"
  on public.tables for select
  to authenticated
  using (true);

drop policy if exists "tables_write_authenticated" on public.tables;
create policy "tables_write_authenticated"
  on public.tables for all
  to authenticated
  using (true)
  with check (true);

-- ORDER_ITEMS
drop policy if exists "order_items_select_authenticated" on public.order_items;
create policy "order_items_select_authenticated"
  on public.order_items for select
  to authenticated
  using (true);

drop policy if exists "order_items_write_authenticated" on public.order_items;
create policy "order_items_write_authenticated"
  on public.order_items for all
  to authenticated
  using (true)
  with check (true);

-- SALES
drop policy if exists "sales_select_authenticated" on public.sales;
create policy "sales_select_authenticated"
  on public.sales for select
  to authenticated
  using (true);

drop policy if exists "sales_write_authenticated" on public.sales;
create policy "sales_write_authenticated"
  on public.sales for all
  to authenticated
  using (true)
  with check (true);

-- ============================================================================
-- Fim do schema. Após rodar este script, copie a "Project URL" e a "anon
-- public key" (Project Settings > API) para src/config/env.ts.
-- ============================================================================
