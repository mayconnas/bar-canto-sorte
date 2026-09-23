/**
 * Sistema de escala responsiva global do Canto da Sorte.
 *
 * PROBLEMA QUE RESOLVE
 * --------------------
 * Todos os tamanhos do app (fontSize, padding, gap, largura/altura de botões,
 * cards e logo) foram calibrados para a tela LARGA de 1440px do mockup
 * (PDV Canto da Sorte.dc.html). Num tablet de ~800-1280px isso fica GRANDE
 * DEMAIS — parece "zoom" e os elementos se sobrepõem/quebram.
 *
 * SOLUÇÃO
 * -------
 * Em vez de ajustar peça por peça, derivamos um FATOR DE ESCALA a partir da
 * largura da tela (comparada a uma largura de referência). Esse fator multiplica
 * fontes/paddings/dimensões, encolhendo TUDO proporcionalmente em telas menores.
 * Assim o layout mantém a identidade visual do mockup, mas cabe bem em qualquer
 * aparelho — sem zoom e sem quebra.
 *
 * Uso típico em um componente:
 *
 *   const { s, ms, fator, isLandscape } = useScale();
 *   const styles = useMemo(() => StyleSheet.create({
 *     titulo: { fontSize: ms(28), marginBottom: s(16) },
 *     botao:  { paddingVertical: s(12), paddingHorizontal: s(20) },
 *   }), [s, ms]);
 *
 * NOTA: como o fator muda com a largura, os estilos que dependem de s()/ms()
 * devem ser criados DENTRO do componente (via useMemo) e não em um
 * StyleSheet.create de módulo (que só roda uma vez).
 */
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * Largura "cheia" alvo. Propositalmente MENOR que os 1440px do mockup: usamos
 * ~1100 para que telas grandes já batam o fator 1.0 (design base) sem precisar
 * dos 1440px, evitando deixar a UI grande demais em tablets comuns.
 */
export const REFERENCE_WIDTH = 1100;

/** Fator mínimo — não encolher além disso (mantém legibilidade em celulares). */
export const MIN_FACTOR = 0.72;

/** Fator máximo — nunca AMPLIAR além do design base (mockup escalado a 1.0). */
export const MAX_FACTOR = 1.0;

/** Zoom manual mínimo (o usuário pode reduzir a UI até 80%). */
export const MIN_ZOOM = 0.8;

/** Zoom manual máximo (o usuário pode ampliar a UI até 140%). */
export const MAX_ZOOM = 1.4;

/** Limita um número ao intervalo [min, max]. */
function clamp(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

/**
 * Função pura que calcula o fator de escala para uma largura de tela.
 * Exportada para uso FORA de componentes (ex.: cálculos utilitários, testes).
 *
 * Exemplos de fator resultante:
 *   - tablet ~800px  => 800/1100  = ~0.73
 *   - celular ~380px => clamp(0.35) => 0.72 (piso MIN_FACTOR)
 *   - tela >=1100px  => 1.0 (teto MAX_FACTOR)
 *
 * @param width Largura da tela em pixels lógicos (dp).
 * @returns Fator de escala no intervalo [MIN_FACTOR, MAX_FACTOR].
 */
export function scaleFactor(width: number): number {
  return clamp(width / REFERENCE_WIDTH, MIN_FACTOR, MAX_FACTOR);
}

/** Objeto retornado pelo hook useScale(). */
export interface ScaleApi {
  /**
   * Escala LINEAR de um valor pelo fator. Use para padding, margin, gap,
   * largura/altura de botões, cards, logo, raios de borda, etc.
   * @example paddingVertical: s(12)
   */
  s: (n: number) => number;
  /**
   * "Moderate scale" — escala mais SUAVE que s(). Encolhe menos porque só
   * aplica metade da redução: n * (fator + (1 - fator) * 0.5).
   * Ideal para fontSize, onde encolher tanto quanto o layout prejudica a
   * leitura. Em telas grandes (fator 1.0) equivale a s().
   * @example fontSize: ms(28)
   */
  ms: (n: number) => number;
  /** O fator de escala atual (número em [MIN_FACTOR, MAX_FACTOR]). */
  fator: number;
  /** Largura atual da janela em dp. */
  width: number;
  /** Altura atual da janela em dp. */
  height: number;
  /** true quando a tela está em paisagem (largura > altura). */
  isLandscape: boolean;
}

/**
 * Hook de escala responsiva. Reage às mudanças de dimensão da janela
 * (rotação, redimensionamento) via useWindowDimensions e é memoizado pela
 * largura para não recriar as funções a cada render.
 *
 * ZOOM MANUAL: o parâmetro opcional `zoom` (default 1) multiplica o fator
 * responsivo, permitindo que o usuário AMPLIE/REDUZA toda a UI por cima da
 * escala automática (preferência salva no banco pelo store). Compatível com o
 * uso legado: todas as chamadas existentes `useScale()` continuam em zoom=1 e
 * não mudam de comportamento. O zoom é limitado a [MIN_ZOOM, MAX_ZOOM] para
 * nunca quebrar o layout.
 *
 * @param zoom Multiplicador manual do usuário (default 1 = sem zoom extra).
 * @returns {@link ScaleApi} com s(), ms(), fator, width, height, isLandscape.
 */
export function useScale(zoom: number = 1): ScaleApi {
  const { width: rawWidth, height: rawHeight } = useWindowDimensions();

  // Zoom saneado: fora do intervalo válido ou não-finito cai para 1 (neutro),
  // garantindo que um valor corrompido nunca distorça a UI.
  const safeZoom =
    Number.isFinite(zoom) ? clamp(zoom, MIN_ZOOM, MAX_ZOOM) : 1;

  // ESTABILIDADE (WEB): useWindowDimensions pode reportar valores FRACIONÁRIOS
  // e oscilantes na web — o layout muda por frações de pixel ao focar um input,
  // ao surgir/sumir a barra de rolagem ou o teclado virtual, ou durante o
  // scroll. Se width/height mudassem a cada tecla, o useMemo abaixo recriaria
  // s()/ms() (novas identidades) e, em cascata, os StyleSheet.create dos
  // consumidores — o que faz o TextInput focado PERDER O FOCO na web.
  // Arredondamos para pixels inteiros: diferenças sub-pixel são imperceptíveis
  // no layout, mas o valor memoizado deixa de oscilar e mantém s()/ms()/width/
  // height referencialmente estáveis entre re-renders causados por digitação.
  const width = Math.round(rawWidth);
  const height = Math.round(rawHeight);

  return useMemo<ScaleApi>(() => {
    // Fator EFETIVO = fator responsivo automático × zoom manual do usuário.
    // O `fator` exposto na API já embute o zoom para que consumidores que o
    // usem diretamente (raro) também reflitam a preferência.
    const fator = scaleFactor(width) * safeZoom;
    return {
      fator,
      width,
      height,
      isLandscape: width > height,
      s: (n: number): number => n * fator,
      // Escala moderada: aplica só metade da redução do fator responsivo e, por
      // cima, o zoom manual (que amplia/reduz uniformemente).
      ms: (n: number): number =>
        n * (scaleFactor(width) + (1 - scaleFactor(width)) * 0.5) * safeZoom,
    };
    // Depende de width (fator/isLandscape/s/ms), height (isLandscape) e do zoom
    // manual; width/height já arredondados para não oscilar por frações de pixel.
  }, [width, height, safeZoom]);
}
