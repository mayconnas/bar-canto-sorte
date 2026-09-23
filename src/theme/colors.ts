/**
 * Paleta de cores do Canto da Sorte — extraída da logo (madeira, cerveja/dourado, creme)
 * e do mockup PDV Canto da Sorte.dc.html.
 */
export const colors = {
  // Madeira / marrons (fundos escuros, header, sidebar)
  woodDarkest: '#241109',
  woodDark: '#2E1B10',
  woodHeader: '#3B2417',
  woodPanel: '#2A1710',
  woodBorder: '#55341F',
  brown: '#6B4226',
  brownSoft: '#8A6A3C',

  // Dourado / âmbar (cerveja — cor de destaque/ações)
  gold: '#C87F14',
  goldDeep: '#A9670F',
  goldDeepAlt: '#A9702B',
  goldLight: '#D9A441',
  amber: '#E8C77A',
  amberSoft: '#B88950',

  // Creme / claros (fundo principal, cards)
  cream: '#F1E4CB',
  creamCard: '#FBF6EA',
  creamPanel: '#F5EAD2',
  creamAlt: '#EFE3C9',
  creamDeep: '#E7D4B0',
  creamText: '#F4EAD6',

  // Texto
  textDark: '#2E1B10',
  textHeading: '#3B2417',
  textMuted: '#6B4226',
  textFaint: '#A98D63',

  // Bordas claras
  borderCream: '#E0CDA4',
  borderCreamSoft: '#D8C49B',
  borderDashed: '#D3BE93',

  // Estados
  success: '#2E7D32',
  successBg: '#E3F1E3',
  successBorder: '#8FCB93',
  danger: '#B0553A',
  dangerBg: '#F7E3DE',
  dangerBorder: '#E0A99B',

  white: '#FFFFFF',
} as const;

export type AppColors = typeof colors;
