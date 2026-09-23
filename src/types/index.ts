/**
 * Tipos de domínio do PDV Canto da Sorte.
 * Contrato compartilhado por DB, store, telas e sincronização.
 */

/** Seção do cardápio (ex.: "Chopp & Cerveja", "Porções"). */
export interface Section {
  id: string;
  label: string;
  position: number;
  updatedAt: number;
  deleted?: boolean;
}

/** Produto do cardápio. */
export interface Product {
  id: string;
  sectionId: string;
  name: string;
  price: number;
  icon: string; // emoji ou vazio (usa inicial do nome)
  imageUrl: string; // URL pública da foto no Supabase Storage ('' = sem foto)
  available: boolean;
  position: number;
  updatedAt: number;
  deleted?: boolean;
}

/** Item lançado numa comanda/mesa. */
export interface OrderItem {
  id: string;
  productId: string;
  name: string; // snapshot do nome no momento do lançamento
  price: number; // snapshot do preço unitário
  qty: number;
}

/** Status de uma mesa/comanda. */
export type TableStatus = 'livre' | 'ocupada';

/** Mesa (comanda aberta). */
export interface Table {
  id: string;
  num: string; // "01", "02"...
  name: string; // "Mesa 01" ou nome custom
  status: TableStatus;
  items: OrderItem[];
  openedAt: number;
  updatedAt: number;
  deleted?: boolean;
}

/** Formas de pagamento. */
export type PaymentMethod = 'dinheiro' | 'pix' | 'debito' | 'credito';

export interface PaymentOption {
  id: PaymentMethod;
  name: string;
  icon: string;
}

/** Venda finalizada (histórico / relatório). */
export interface Sale {
  id: string;
  tableId: string;
  tableName: string;
  items: OrderItem[];
  total: number;
  payment: PaymentMethod;
  closedAt: number; // timestamp ms
  synced?: boolean;
}

/** Estado de conectividade/sincronização exibido na UI. */
export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'error' | 'disabled';
