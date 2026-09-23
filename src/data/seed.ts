/**
 * Cardápio inicial (seed) do Canto da Sorte — extraído do mockup PDV.
 * Usado apenas na primeira execução, quando o banco local está vazio.
 */
import type { Section, Product } from '../types';

interface SeedSection {
  id: string;
  label: string;
  items: Array<{ id: string; name: string; price: number; icon: string }>;
}

export const SEED_CATALOG: SeedSection[] = [
  {
    id: 'chopp',
    label: 'Chopp & Cerveja',
    items: [
      { id: 'p1', name: 'Chopp Pilsen 300ml', price: 8.0, icon: '🍺' },
      { id: 'p2', name: 'Chopp Escuro 300ml', price: 9.5, icon: '🍺' },
      { id: 'p3', name: 'Long Neck', price: 12.0, icon: '🍾' },
      { id: 'p4', name: 'Cerveja 600ml', price: 15.0, icon: '🍺' },
      { id: 'p5', name: 'Lata 350ml', price: 7.0, icon: '🍺' },
    ],
  },
  {
    id: 'porcoes',
    label: 'Porções',
    items: [
      { id: 'p6', name: 'Batata Frita', price: 28.0, icon: '🍟' },
      { id: 'p7', name: 'Frango a Passarinho', price: 42.0, icon: '🍗' },
      { id: 'p8', name: 'Isca de Peixe', price: 45.0, icon: '🐟' },
      { id: 'p9', name: 'Calabresa Acebolada', price: 35.0, icon: '🍖' },
      { id: 'p10', name: 'Torresmo', price: 30.0, icon: '🥓' },
    ],
  },
  {
    id: 'salgados',
    label: 'Salgados',
    items: [
      { id: 'p11', name: 'Coxinha', price: 8.0, icon: '🥔' },
      { id: 'p12', name: 'Pastel', price: 9.0, icon: '🥟' },
      { id: 'p13', name: 'Bolinho de Bacalhau', price: 12.0, icon: '🍤' },
      { id: 'p14', name: 'Kibe', price: 8.0, icon: '🧆' },
    ],
  },
  {
    id: 'outros',
    label: 'Drinks & Sucos',
    items: [
      { id: 'p15', name: 'Caipirinha', price: 18.0, icon: '🍹' },
      { id: 'p16', name: 'Refrigerante', price: 6.0, icon: '🥤' },
      { id: 'p17', name: 'Água', price: 4.0, icon: '💧' },
      { id: 'p18', name: 'Suco Natural', price: 8.0, icon: '🧃' },
    ],
  },
];

/** Formas de pagamento (fixas). */
export const PAYMENT_OPTIONS = [
  { id: 'dinheiro', name: 'Dinheiro', icon: '💵' },
  { id: 'pix', name: 'Pix', icon: '⚡' },
  { id: 'debito', name: 'Débito', icon: '💳' },
  { id: 'credito', name: 'Crédito', icon: '💳' },
] as const;

/** Converte o seed no formato normalizado (Section[] + Product[]) para o banco. */
export function buildSeedRows(now: number): { sections: Section[]; products: Product[] } {
  const sections: Section[] = [];
  const products: Product[] = [];
  SEED_CATALOG.forEach((sec, si) => {
    sections.push({ id: sec.id, label: sec.label, position: si, updatedAt: now });
    sec.items.forEach((it, pi) => {
      products.push({
        id: it.id,
        sectionId: sec.id,
        name: it.name,
        price: it.price,
        icon: it.icon,
        imageUrl: '',
        available: true,
        position: pi,
        updatedAt: now,
      });
    });
  });
  return { sections, products };
}
