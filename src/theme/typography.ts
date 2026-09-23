/**
 * Fontes do Canto da Sorte.
 * Pacifico  -> título/marca ("Canto da Sorte")
 * Oswald    -> rótulos, números, botões (condensada, uppercase)
 * Manrope   -> texto geral / nomes de produtos
 *
 * As fontes são carregadas em App.tsx via expo-font (@expo-google-fonts).
 */
export const fonts = {
  brand: 'Pacifico_400Regular',
  heading: 'Oswald_600SemiBold',
  headingMedium: 'Oswald_500Medium',
  headingRegular: 'Oswald_400Regular',
  headingBold: 'Oswald_700Bold',
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodyBold: 'Manrope_700Bold',
  bodyExtra: 'Manrope_800ExtraBold',
} as const;

/** Nomes usados na chamada useFonts(...) — mapeados no App.tsx. */
export type FontKey = keyof typeof fonts;
