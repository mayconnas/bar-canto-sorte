/**
 * Sistema de BREAKPOINTS ADAPTATIVOS do Canto da Sorte.
 *
 * Complementa o useScale (que ESCALA os tamanhos): aqui decidimos a ESTRUTURA
 * do layout por faixa de tela (adaptativo), não só o tamanho. É a peça que
 * faltava para o app ser 100% responsivo em qualquer aparelho.
 *
 * Conceito (pesquisa de mercado 2025): "responsivo" (escala) + "adaptativo"
 * (troca de layout por breakpoint) juntos. Em tablet paisagem usamos layout de
 * duas colunas / master-detail; em tablet retrato, largura total + gaveta; em
 * celular, tudo empilhado.
 *
 * IMPORTANTE: usa useWindowDimensions (reativo a rotação/resize), com o width
 * ARREDONDADO (Math.round) — no web, valores fracionários oscilantes recriavam
 * estilos e derrubavam o foco de inputs. Memoizado por [width, height].
 */
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * Faixas de largura em DP (não pixels físicos!). Padrão de mercado adaptado ao
 * app: um tablet 10" reporta ~500-600dp em retrato e ~800-853dp em paisagem.
 */
export const BREAKPOINTS = {
  /** Celular pequeno. */
  xs: 0,
  /** Celular grande / tablet pequeno em retrato. */
  sm: 480,
  /** Tablet retrato / celular em paisagem. */
  md: 640,
  /** Tablet paisagem / telas largas — layout de 2 colunas. */
  lg: 900,
  /** Desktop / telas muito largas. */
  xl: 1200,
} as const;

export type BreakpointKey = keyof typeof BREAKPOINTS;

/** Modo de layout que a UI deve adotar (adaptativo). */
export type LayoutMode =
  | 'phone' // celular: tudo empilhado, navegação por etapas/gaveta
  | 'tabletPortrait' // tablet em pé: largura total + gaveta de produtos
  | 'tabletLandscape'; // tablet deitado / desktop: 2 colunas (master-detail)

export interface BreakpointApi {
  width: number;
  height: number;
  /** true quando largura > altura. */
  isLandscape: boolean;
  /** A faixa atual ('xs' | 'sm' | 'md' | 'lg' | 'xl'). */
  breakpoint: BreakpointKey;
  /** Modo de layout adaptativo derivado da largura + orientação. */
  layout: LayoutMode;
  /** Atalhos booleanos. */
  isPhone: boolean;
  isTabletPortrait: boolean;
  isTabletLandscape: boolean;
  /** true se a largura for >= o breakpoint informado (ex.: up('lg')). */
  up: (bp: BreakpointKey) => boolean;
  /** true se a largura for < o breakpoint informado (ex.: down('md')). */
  down: (bp: BreakpointKey) => boolean;
}

/** Resolve a faixa de breakpoint a partir da largura (dp). */
export function breakpointFor(width: number): BreakpointKey {
  if (width >= BREAKPOINTS.xl) return 'xl';
  if (width >= BREAKPOINTS.lg) return 'lg';
  if (width >= BREAKPOINTS.md) return 'md';
  if (width >= BREAKPOINTS.sm) return 'sm';
  return 'xs';
}

/**
 * Decide o MODO DE LAYOUT (adaptativo), combinando largura e orientação:
 *  - >= lg (900dp) OU paisagem com largura razoável (>= md) => 2 colunas (tablet paisagem).
 *  - largura média (md..lg) em retrato => tablet retrato (largura total + gaveta).
 *  - abaixo de md => celular (empilhado).
 */
export function layoutModeFor(width: number, height: number): LayoutMode {
  const landscape = width > height;
  if (width >= BREAKPOINTS.lg || (landscape && width >= BREAKPOINTS.md)) {
    return 'tabletLandscape';
  }
  if (width >= BREAKPOINTS.md) {
    return 'tabletPortrait';
  }
  return 'phone';
}

/**
 * Hook de breakpoints adaptativos. Use junto do useScale:
 *   const { layout, isTabletLandscape } = useBreakpoint();
 *   const { s, ms } = useScale(zoom);
 * O breakpoint decide a ESTRUTURA; o useScale ajusta os TAMANHOS.
 */
export function useBreakpoint(): BreakpointApi {
  const { width: rawW, height: rawH } = useWindowDimensions();
  const width = Math.round(rawW);
  const height = Math.round(rawH);

  return useMemo<BreakpointApi>(() => {
    const breakpoint = breakpointFor(width);
    const layout = layoutModeFor(width, height);
    return {
      width,
      height,
      isLandscape: width > height,
      breakpoint,
      layout,
      isPhone: layout === 'phone',
      isTabletPortrait: layout === 'tabletPortrait',
      isTabletLandscape: layout === 'tabletLandscape',
      up: (bp) => width >= BREAKPOINTS[bp],
      down: (bp) => width < BREAKPOINTS[bp],
    };
  }, [width, height]);
}
