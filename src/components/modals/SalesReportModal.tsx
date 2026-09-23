/**
 * Modal "Relatório de Vendas" — visão consolidada do movimento do bar.
 *
 * Segue o visual dos demais modais (CheckoutModal etc.): overlay escuro,
 * header em madeira (woodHeader) com título + ícone, corpo em creamCard.
 *
 * Conteúdo:
 *  - Seletor de período (Hoje / 7 dias / Este mês) como segmented control.
 *  - KPIs em cards: Total vendido (card escuro de destaque), Nº de vendas,
 *    Ticket médio (responsivos: empilham em telas estreitas, ficam lado a
 *    lado em telas largas).
 *  - Quebra por forma de pagamento (Dinheiro / Pix / Débito / Crédito).
 *  - Mais vendidos (top produtos por quantidade) — ranking em linhas.
 *  - Lista de vendas do período (mesa, forma, horário, total) — rolável.
 *  - Estados de carregando e vazio.
 *
 * Toda a leitura vem da camada de dados pronta em ../../db/database
 * (getSalesSummary, getTopProducts, getSalesBetween + helpers de intervalo).
 * Nada é mutado aqui; é somente leitura.
 *
 * Responsividade: todos os tamanhos passam por s()/ms() de useScale(); os
 * estilos que dependem do fator são criados dentro do componente via useMemo.
 * O scroll do corpo é destravado: o card tem ALTURA EM PIXELS (calculada da
 * altura da janela via useScale().height) e o <ScrollView> interno usa flex:1,
 * recebendo o espaço restante abaixo do header/seletor e rolando. O overlay é
 * um <View> (não Pressable): só o botão X fecha, então o arraste para rolar
 * nunca é confundido com "tocar fora".
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { PaymentMethod, Sale } from '../../types';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/typography';
import { money, usePdvStore } from '../../store/usePdvStore';
import { useScale } from '../../theme/scale';
import { buildSalesReportHtml } from '../../utils/reportPdf';
import {
  dayRange,
  weekRange,
  monthRange,
  getSalesBetween,
  getSalesSummary,
  getTopProducts,
} from '../../db/database';

interface SalesReportModalProps {
  visible: boolean;
  onClose: () => void;
}

type PeriodKey = 'hoje' | 'semana' | 'mes';

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'semana', label: '7 dias' },
  { key: 'mes', label: 'Este mês' },
];

/** Metadados visuais (ordem, rótulo, ícone Feather, cor) de cada forma. */
const PAYMENT_META: Array<{
  id: PaymentMethod;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
}> = [
  { id: 'dinheiro', label: 'Dinheiro', icon: 'dollar-sign', color: colors.success },
  { id: 'pix', label: 'Pix', icon: 'zap', color: colors.gold },
  { id: 'debito', label: 'Débito', icon: 'credit-card', color: colors.brown },
  { id: 'credito', label: 'Crédito', icon: 'credit-card', color: colors.goldDeepAlt },
];

type SummaryShape = Awaited<ReturnType<typeof getSalesSummary>>;
type TopProduct = Awaited<ReturnType<typeof getTopProducts>>[number];

/** Resolve o intervalo [start, end) a partir do período selecionado. */
function rangeFor(period: PeriodKey): { start: number; end: number } {
  switch (period) {
    case 'hoje':
      return dayRange(0);
    case 'semana':
      return weekRange();
    case 'mes':
      return monthRange();
  }
}

/** "14:35" a partir de um timestamp em ms. */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** "24/07" — usado quando o período abrange mais de um dia. */
function formatDay(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mo}`;
}

const MONTHS_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

/** "24/07/2026" a partir de um timestamp em ms. */
function formatFullDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mo}/${d.getFullYear()}`;
}

/** Rótulo do período por extenso, coerente com o segmented control selecionado. */
function periodLabelFor(period: PeriodKey): string {
  switch (period) {
    case 'hoje':
      return `Hoje — ${formatFullDate(Date.now())}`;
    case 'semana': {
      const { start, end } = weekRange();
      // `end` é o início de amanhã; o último dia incluído é end - 1ms.
      return `Últimos 7 dias — ${formatDay(start)} a ${formatDay(end - 1)}`;
    }
    case 'mes': {
      const d = new Date();
      return `${MONTHS_PT[d.getMonth()]}/${d.getFullYear()}`;
    }
  }
}

export default function SalesReportModal({
  visible,
  onClose,
}: SalesReportModalProps) {
  const { s, ms, width, height } = useScale();

  // Em telas estreitas os KPIs empilham (coluna única).
  const stackKpis = width < 520;

  const flash = usePdvStore((st) => st.flash);

  const [period, setPeriod] = useState<PeriodKey>('hoje');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [summary, setSummary] = useState<SummaryShape | null>(null);
  const [top, setTop] = useState<TopProduct[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);

  // Nos períodos multi-dia mostramos a data junto do horário.
  const showDate = period !== 'hoje';

  const load = useCallback(async (p: PeriodKey) => {
    setLoading(true);
    try {
      const { start, end } = rangeFor(p);
      const [sum, tp, list] = await Promise.all([
        getSalesSummary(start, end),
        getTopProducts(start, end, 5),
        getSalesBetween(start, end),
      ]);
      setSummary(sum);
      setTop(tp);
      setSales(list);
    } catch {
      setSummary(null);
      setTop([]);
      setSales([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Carrega ao abrir e sempre que o período muda.
  useEffect(() => {
    if (visible) load(period);
  }, [visible, period, load]);

  const total = summary?.total ?? 0;
  const count = summary?.count ?? 0;
  const avg = count > 0 ? total / count : 0;
  const isEmpty = !loading && count === 0;

  const kpis = useMemo(
    () => [
      { label: 'Total vendido', value: money(total), strong: true },
      { label: 'Nº de vendas', value: String(count), strong: false },
      { label: 'Ticket médio', value: money(avg), strong: false },
    ],
    [total, count, avg],
  );

  // Gera o PDF do período ATUALMENTE selecionado (reusa summary/top/sales do
  // estado) e abre o menu nativo de compartilhamento (WhatsApp, e-mail, Drive…).
  const handleExportPdf = useCallback(async () => {
    if (exporting) return;
    if (loading || !summary || count === 0) {
      flash('Nenhuma venda no período para exportar.');
      return;
    }
    setExporting(true);
    try {
      const html = buildSalesReportHtml({
        periodLabel: periodLabelFor(period),
        generatedAt: Date.now(),
        summary,
        top,
        sales,
      });
      const { uri } = await Print.printToFileAsync({ html });

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        flash('Compartilhamento indisponível neste dispositivo.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Compartilhar relatório de vendas',
        UTI: 'com.adobe.pdf',
      });
    } catch {
      Alert.alert('Erro', 'Não foi possível gerar o PDF. Tente novamente.');
    } finally {
      setExporting(false);
    }
  }, [exporting, loading, summary, count, period, top, sales, flash]);

  // Largura responsiva do card do modal.
  const cardWidth = Math.min(s(560), width - s(40));

  // Altura do card em PIXELS (não '%'). Uma altura percentual dentro de um pai
  // flex centralizado (overlay com justify/align 'center') não resolve de forma
  // confiável para um valor definido — e sem altura definida no card o
  // ScrollView interno (flex:1) mede o próprio conteúdo em vez de ficar acotado,
  // e NÃO ROLA (a causa raiz do bug). Calcular a partir da altura da janela dá
  // um número concreto, garantindo a cadeia de alturas em Android E web.
  // Descontamos o padding vertical do overlay (2× s(20)) para o card sempre
  // caber na área disponível; alvo 90% do espaço útil, com piso de segurança.
  const cardHeight = Math.max(s(320), Math.round((height - s(40)) * 0.9));

  const styles = useMemo(
    () =>
      StyleSheet.create({
        overlay: {
          flex: 1,
          backgroundColor: 'rgba(30,15,7,0.62)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: s(20),
        },
        card: {
          width: cardWidth,
          // Altura em PIXELS (85% da janela) — não '%'. Assim o card tem uma
          // altura DEFINIDA e o ScrollView interno (flex:1) recebe o espaço
          // restante e ROLA. Percentual dentro de um pai flex centralizado não
          // resolve de forma confiável (era a causa do modal não rolar).
          height: cardHeight,
          backgroundColor: colors.creamCard,
          borderRadius: s(22),
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.borderCream,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: s(24) },
          shadowOpacity: 0.4,
          shadowRadius: s(40),
          elevation: 24,
        },

        // Header
        header: {
          paddingVertical: s(18),
          paddingHorizontal: s(22),
          backgroundColor: colors.woodHeader,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: s(12),
        },
        headerTitleWrap: {
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: s(12),
        },
        headerIcon: {
          width: s(40),
          height: s(40),
          borderRadius: s(12),
          backgroundColor: 'rgba(255,255,255,0.08)',
          alignItems: 'center',
          justifyContent: 'center',
        },
        headerKicker: {
          fontFamily: fonts.headingMedium,
          fontSize: ms(10),
          letterSpacing: 2.4,
          textTransform: 'uppercase',
          color: colors.amberSoft,
        },
        headerTitle: {
          fontFamily: fonts.heading,
          fontSize: ms(22),
          color: colors.creamText,
          marginTop: 1,
        },
        headerActions: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: s(10),
        },
        shareBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: s(7),
          height: s(36),
          paddingHorizontal: s(13),
          borderRadius: s(10),
          backgroundColor: colors.gold,
        },
        shareBtnDisabled: {
          opacity: 0.55,
        },
        shareBtnLabel: {
          fontFamily: fonts.heading,
          fontSize: ms(12),
          letterSpacing: 0.6,
          color: colors.white,
        },
        closeBtn: {
          width: s(36),
          height: s(36),
          borderRadius: s(10),
          backgroundColor: 'rgba(255,255,255,0.08)',
          alignItems: 'center',
          justifyContent: 'center',
        },

        // Seletor de período (segmented control)
        periodBar: {
          flexDirection: 'row',
          paddingHorizontal: s(22),
          paddingVertical: s(14),
          backgroundColor: colors.creamPanel,
          borderBottomWidth: 1,
          borderBottomColor: '#EAD9B6',
        },
        segment: {
          flexDirection: 'row',
          backgroundColor: colors.creamAlt,
          borderRadius: s(12),
          padding: s(4),
          borderWidth: 1,
          borderColor: colors.borderCreamSoft,
          flex: 1,
          gap: s(4),
        },
        chip: {
          flex: 1,
          minHeight: s(44),
          paddingVertical: s(9),
          borderRadius: s(9),
          alignItems: 'center',
          justifyContent: 'center',
        },
        chipActive: {
          backgroundColor: colors.gold,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: s(2) },
          shadowOpacity: 0.18,
          shadowRadius: s(4),
          elevation: 3,
        },
        chipText: {
          fontFamily: fonts.heading,
          fontSize: ms(12),
          letterSpacing: 1,
          textTransform: 'uppercase',
          color: colors.textMuted,
        },
        chipTextActive: {
          color: colors.white,
        },

        // Estados centrais (loading / vazio)
        centerWrap: {
          paddingVertical: s(64),
          paddingHorizontal: s(24),
          alignItems: 'center',
          justifyContent: 'center',
          gap: s(14),
        },
        emptyIcon: {
          width: s(72),
          height: s(72),
          borderRadius: s(36),
          backgroundColor: colors.creamPanel,
          borderWidth: 1,
          borderColor: colors.borderCream,
          alignItems: 'center',
          justifyContent: 'center',
        },
        centerText: {
          fontFamily: fonts.body,
          fontSize: ms(14),
          color: colors.textFaint,
          textAlign: 'center',
        },

        // Corpo
        body: {
          // flex:1 faz o ScrollView ocupar o espaço restante do card (abaixo do
          // header/seletor) e então ROLAR o conteúdo. Sem isso ele não rola.
          flex: 1,
        },
        bodyContent: {
          paddingHorizontal: s(20),
          paddingTop: s(18),
          paddingBottom: s(24),
        },

        // KPIs
        kpiRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: s(10),
        },
        kpiColumn: {
          flexDirection: 'column',
        },
        kpiCard: {
          borderRadius: s(16),
          borderWidth: 1,
          borderColor: colors.borderCream,
          backgroundColor: colors.white,
          paddingVertical: s(16),
          paddingHorizontal: s(16),
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: s(3) },
          shadowOpacity: 0.06,
          shadowRadius: s(6),
          elevation: 1,
        },
        kpiCardInline: {
          flex: 1,
          minWidth: s(150),
        },
        kpiCardStacked: {
          width: '100%',
        },
        kpiCardStrong: {
          backgroundColor: colors.woodHeader,
          borderColor: colors.woodBorder,
          shadowOpacity: 0.22,
          shadowRadius: s(12),
          shadowOffset: { width: 0, height: s(6) },
          elevation: 4,
        },
        kpiStrongIcon: {
          width: s(34),
          height: s(34),
          borderRadius: s(10),
          backgroundColor: 'rgba(232,199,122,0.16)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: s(10),
        },
        kpiLabel: {
          fontFamily: fonts.headingMedium,
          fontSize: ms(10),
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: colors.textMuted,
          marginBottom: s(6),
        },
        kpiLabelStrong: {
          color: colors.amberSoft,
        },
        kpiValue: {
          fontFamily: fonts.headingBold,
          fontSize: ms(23),
          color: colors.textHeading,
        },
        kpiValueStrong: {
          color: colors.creamText,
          fontSize: ms(30),
        },

        // Títulos de seção
        sectionTitle: {
          fontFamily: fonts.heading,
          fontSize: ms(11),
          letterSpacing: 1.8,
          textTransform: 'uppercase',
          color: colors.goldDeepAlt,
          marginTop: s(22),
          marginBottom: s(10),
        },

        // Bloco/cartão de listas
        block: {
          borderRadius: s(16),
          borderWidth: 1,
          borderColor: colors.borderCream,
          backgroundColor: colors.white,
          paddingHorizontal: s(14),
          shadowColor: '#000',
          shadowOffset: { width: 0, height: s(3) },
          shadowOpacity: 0.06,
          shadowRadius: s(6),
          elevation: 1,
        },
        rowDivider: {
          borderTopWidth: 1,
          borderTopColor: '#EEE1C4',
        },
        mutedInline: {
          fontFamily: fonts.body,
          fontSize: ms(13),
          color: colors.textFaint,
          paddingVertical: s(16),
          textAlign: 'center',
        },

        // Forma de pagamento
        payRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: s(10),
          paddingVertical: s(13),
          minHeight: s(44),
        },
        payIcon: {
          width: s(30),
          height: s(30),
          borderRadius: s(9),
          alignItems: 'center',
          justifyContent: 'center',
        },
        payLabel: {
          flex: 1,
          fontFamily: fonts.bodyBold,
          fontSize: ms(14),
          color: colors.textHeading,
        },
        payCount: {
          fontFamily: fonts.body,
          fontSize: ms(12),
          color: colors.textFaint,
          marginRight: s(4),
        },
        payTotal: {
          fontFamily: fonts.heading,
          fontSize: ms(15),
          color: colors.textHeading,
          minWidth: s(84),
          textAlign: 'right',
        },

        // Top produtos
        topRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: s(10),
          paddingVertical: s(13),
          minHeight: s(44),
        },
        rank: {
          width: s(26),
          height: s(26),
          borderRadius: s(8),
          backgroundColor: colors.amber,
          alignItems: 'center',
          justifyContent: 'center',
        },
        rankLead: {
          backgroundColor: colors.gold,
        },
        rankText: {
          fontFamily: fonts.headingBold,
          fontSize: ms(12),
          color: colors.textDark,
        },
        rankTextLead: {
          color: colors.white,
        },
        topName: {
          flex: 1,
          fontFamily: fonts.bodyBold,
          fontSize: ms(14),
          color: colors.textHeading,
        },
        topQty: {
          fontFamily: fonts.heading,
          fontSize: ms(13),
          color: colors.goldDeepAlt,
          marginRight: s(4),
        },
        topTotal: {
          fontFamily: fonts.heading,
          fontSize: ms(14),
          color: colors.textHeading,
          minWidth: s(78),
          textAlign: 'right',
        },

        // Vendas
        saleRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: s(12),
          paddingVertical: s(13),
          minHeight: s(44),
        },
        saleIcon: {
          width: s(34),
          height: s(34),
          borderRadius: s(10),
          backgroundColor: colors.creamPanel,
          alignItems: 'center',
          justifyContent: 'center',
        },
        saleTable: {
          fontFamily: fonts.bodyBold,
          fontSize: ms(14),
          color: colors.textHeading,
        },
        saleMetaRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: s(5),
          marginTop: s(3),
        },
        saleMetaText: {
          fontFamily: fonts.body,
          fontSize: ms(12),
          color: colors.textFaint,
        },
        saleDot: {
          fontSize: ms(10),
          color: colors.textFaint,
        },
        saleTotal: {
          fontFamily: fonts.heading,
          fontSize: ms(16),
          color: colors.textHeading,
          minWidth: s(84),
          textAlign: 'right',
        },
      }),
    [s, ms, cardWidth, cardHeight],
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Overlay = View (não Pressable): só o botão X fecha. Evita que o arraste
          para rolar o relatório seja confundido com "tocar fora" e feche a tela. */}
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <View style={styles.headerIcon}>
                <Feather name="bar-chart-2" size={ms(18)} color={colors.amber} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.headerKicker}>Gestão</Text>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  Relatório de Vendas
                </Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.shareBtn,
                  exporting && styles.shareBtnDisabled,
                  pressed && !exporting && { opacity: 0.82 },
                ]}
                onPress={handleExportPdf}
                disabled={exporting}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Compartilhar relatório em PDF"
                accessibilityState={{ disabled: exporting, busy: exporting }}
              >
                {exporting ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Feather name="share-2" size={ms(15)} color={colors.white} />
                )}
                <Text style={styles.shareBtnLabel}>
                  {exporting ? 'Gerando…' : 'PDF'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.closeBtn}
                onPress={onClose}
                hitSlop={8}
                accessibilityLabel="Fechar"
              >
                <Feather name="x" size={ms(18)} color={colors.amber} />
              </Pressable>
            </View>
          </View>

          {/* Seletor de período (segmented control) */}
          <View style={styles.periodBar}>
            <View style={styles.segment}>
              {PERIODS.map((p) => {
                const active = period === p.key;
                return (
                  <Pressable
                    key={p.key}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && !active && { opacity: 0.6 },
                    ]}
                    onPress={() => setPeriod(p.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[styles.chipText, active && styles.chipTextActive]}
                    >
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Corpo */}
          {loading ? (
            <View style={styles.centerWrap}>
              <ActivityIndicator size="large" color={colors.gold} />
              <Text style={styles.centerText}>Carregando…</Text>
            </View>
          ) : isEmpty ? (
            <View style={styles.centerWrap}>
              <View style={styles.emptyIcon}>
                <Feather name="inbox" size={ms(30)} color={colors.textFaint} />
              </View>
              <Text style={styles.centerText}>Nenhuma venda no período.</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {/* KPIs */}
              <View style={[styles.kpiRow, stackKpis && styles.kpiColumn]}>
                {kpis.map((k) => (
                  <View
                    key={k.label}
                    style={[
                      styles.kpiCard,
                      stackKpis ? styles.kpiCardStacked : styles.kpiCardInline,
                      k.strong && styles.kpiCardStrong,
                    ]}
                  >
                    {k.strong && (
                      <View style={styles.kpiStrongIcon}>
                        <Feather
                          name="trending-up"
                          size={ms(18)}
                          color={colors.amber}
                        />
                      </View>
                    )}
                    <Text
                      style={[styles.kpiLabel, k.strong && styles.kpiLabelStrong]}
                    >
                      {k.label}
                    </Text>
                    <Text
                      style={[styles.kpiValue, k.strong && styles.kpiValueStrong]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      {k.value}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Quebra por forma de pagamento */}
              <Text style={styles.sectionTitle}>Formas de pagamento</Text>
              <View style={styles.block}>
                {PAYMENT_META.map((pm, idx) => {
                  const data = summary?.byPayment[pm.id];
                  const t = data?.total ?? 0;
                  const c = data?.count ?? 0;
                  return (
                    <View
                      key={pm.id}
                      style={[styles.payRow, idx > 0 && styles.rowDivider]}
                    >
                      <View
                        style={[styles.payIcon, { backgroundColor: pm.color }]}
                      >
                        <Feather
                          name={pm.icon}
                          size={ms(14)}
                          color={colors.white}
                        />
                      </View>
                      <Text style={styles.payLabel}>{pm.label}</Text>
                      <Text style={styles.payCount}>
                        {c} {c === 1 ? 'venda' : 'vendas'}
                      </Text>
                      <Text style={styles.payTotal}>{money(t)}</Text>
                    </View>
                  );
                })}
              </View>

              {/* Mais vendidos */}
              <Text style={styles.sectionTitle}>Mais vendidos</Text>
              <View style={styles.block}>
                {top.length === 0 ? (
                  <Text style={styles.mutedInline}>Sem itens no período.</Text>
                ) : (
                  top.map((prod, idx) => (
                    <View
                      key={`${prod.name}-${idx}`}
                      style={[styles.topRow, idx > 0 && styles.rowDivider]}
                    >
                      <View
                        style={[styles.rank, idx === 0 && styles.rankLead]}
                      >
                        <Text
                          style={[
                            styles.rankText,
                            idx === 0 && styles.rankTextLead,
                          ]}
                        >
                          {idx + 1}
                        </Text>
                      </View>
                      <Text style={styles.topName} numberOfLines={1}>
                        {prod.name}
                      </Text>
                      <Text style={styles.topQty}>{prod.qty}x</Text>
                      <Text style={styles.topTotal}>{money(prod.total)}</Text>
                    </View>
                  ))
                )}
              </View>

              {/* Lista de vendas */}
              <Text style={styles.sectionTitle}>
                Vendas do período ({sales.length})
              </Text>
              <View style={styles.block}>
                {sales.map((sale, idx) => {
                  const meta =
                    PAYMENT_META.find((m) => m.id === sale.payment) ??
                    PAYMENT_META[0];
                  return (
                    <View
                      key={sale.id}
                      style={[styles.saleRow, idx > 0 && styles.rowDivider]}
                    >
                      <View style={styles.saleIcon}>
                        <Feather
                          name="shopping-bag"
                          size={ms(15)}
                          color={colors.goldDeepAlt}
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.saleTable} numberOfLines={1}>
                          {sale.tableName}
                        </Text>
                        <View style={styles.saleMetaRow}>
                          <Feather
                            name={meta.icon}
                            size={ms(11)}
                            color={meta.color}
                          />
                          <Text style={styles.saleMetaText}>{meta.label}</Text>
                          <Text style={styles.saleDot}>•</Text>
                          <Text style={styles.saleMetaText}>
                            {showDate
                              ? `${formatDay(sale.closedAt)} ${formatTime(sale.closedAt)}`
                              : formatTime(sale.closedAt)}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.saleTotal}>{money(sale.total)}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
