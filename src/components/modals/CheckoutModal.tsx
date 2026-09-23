/**
 * Modal "Comanda" (checkout) — fecha uma mesa.
 *
 * Segue o mockup: header madeira ("Comanda / <nome da mesa>"), lista de itens
 * em cards com controles -/+ de quantidade e subtotal, bloco de Total em
 * destaque, grade de 4 formas de pagamento selecionáveis (destaque dourado com
 * ícone Feather + marca de seleção) e botão verde "Confirmar Pagamento"
 * (desabilitado até escolher a forma). Fecha no overlay ou no X.
 *
 * Toda mutação (quantidade / finalização) passa pelo store, que persiste e
 * dá o feedback via toast.
 *
 * ESCALA RESPONSIVA: fontes/paddings/dimensões passam por s()/ms() (useScale)
 * para encolher proporcionalmente em telas menores (sem "zoom"). A largura do
 * card é acotada por Math.min(s(480), width - margem) para caber em telas
 * estreitas; a grade de pagamento quebra em 2 colunas quando o card fica
 * estreito.
 *
 * SCROLL: o card é um <View> (não Pressable) para NÃO engolir o gesto de
 * arraste do ScrollView interno; o fechar-ao-tocar-fora fica só no overlay
 * externo (o card bloqueia a propagação via onStartShouldSetResponder). O
 * ScrollView usa flex:1 dentro de um card com altura acotada (maxHeight).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import type { PaymentMethod } from '../../types';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/typography';
import { PAYMENT_OPTIONS } from '../../data/seed';
import {
  money,
  tableTotal,
  useSelectedTable,
  usePdvStore,
} from '../../store/usePdvStore';
import { useScale } from '../../theme/scale';

interface CheckoutModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Ícone Feather por forma de pagamento (visual consistente com o resto da UI,
 * em vez de emojis que renderizam diferente por plataforma). O emoji do seed
 * continua sendo a fonte de verdade dos dados; aqui é só a camada visual.
 */
const PAY_ICON: Record<PaymentMethod, keyof typeof Feather.glyphMap> = {
  dinheiro: 'dollar-sign',
  pix: 'zap',
  debito: 'credit-card',
  credito: 'credit-card',
};

export default function CheckoutModal({ visible, onClose }: CheckoutModalProps) {
  const table = useSelectedTable();
  const changeQty = usePdvStore((s) => s.changeQty);
  const finalizeTable = usePdvStore((s) => s.finalizeTable);

  const { s, ms, width, height } = useScale();

  const [payment, setPayment] = useState<PaymentMethod | null>(null);

  // Ao (re)abrir, zera a forma de pagamento escolhida.
  useEffect(() => {
    if (visible) setPayment(null);
  }, [visible, table?.id]);

  const items = table?.items ?? [];
  const total = tableTotal(table);
  const isEmpty = items.length === 0;
  const canConfirm = !isEmpty && payment !== null;

  // Quantidade total de unidades (para o resumo do header).
  const totalQty = useMemo(
    () => items.reduce((sum, it) => sum + it.qty, 0),
    [items],
  );

  const confirm = async () => {
    if (!table || !payment || isEmpty) return;
    await finalizeTable(table.id, payment);
    onClose();
  };

  // Largura útil do card (para decidir a quebra da grade de pagamento).
  const cardWidth = Math.min(s(480), width - s(40));
  // Em cards estreitos, empilha as 4 formas em 2 colunas (48% cada).
  const payTwoCols = cardWidth < s(400);

  // Estilos dinâmicos (dependem do fator de escala / dimensões da janela).
  const dyn = useMemo(
    () =>
      StyleSheet.create({
        overlay: {
          padding: s(28),
        },
        card: {
          width: cardWidth,
          borderRadius: s(20),
          // Altura máxima acotada por dp real (garante ScrollView com altura).
          maxHeight: height - s(40),
        },
        header: {
          paddingVertical: s(18),
          paddingHorizontal: s(22),
          gap: s(12),
        },
        headerKicker: { fontSize: ms(10) },
        headerTitle: { fontSize: ms(23) },
        headerBadge: {
          paddingHorizontal: s(10),
          paddingVertical: s(5),
          borderRadius: s(20),
          gap: s(5),
        },
        headerBadgeText: { fontSize: ms(11) },
        closeBtn: { width: s(36), height: s(36), borderRadius: s(10) },

        listContent: {
          paddingHorizontal: s(18),
          paddingTop: s(14),
          paddingBottom: s(6),
          gap: s(9),
        },

        emptyWrap: { paddingVertical: s(48), gap: s(14) },
        emptyIcon: {
          width: s(64),
          height: s(64),
          borderRadius: s(32),
        },
        emptyTitle: { fontSize: ms(15) },
        emptyText: { fontSize: ms(12.5), maxWidth: s(240) },

        itemCard: {
          borderRadius: s(14),
          paddingVertical: s(11),
          paddingHorizontal: s(13),
          gap: s(12),
        },
        itemName: { fontSize: ms(14.5) },
        itemUnit: { fontSize: ms(11.5), marginTop: s(2) },

        qtyControls: { gap: s(2), borderRadius: s(11), padding: s(3) },
        stepBtn: { width: s(34), height: s(34), borderRadius: s(9) },
        qtyValue: { fontSize: ms(15), minWidth: s(30) },

        subtotalPill: {
          minWidth: s(78),
          paddingVertical: s(5),
          paddingHorizontal: s(9),
          borderRadius: s(9),
        },
        itemSubtotal: { fontSize: ms(15) },

        footer: {
          paddingHorizontal: s(20),
          paddingTop: s(16),
          paddingBottom: s(20),
          gap: s(16),
        },

        totalCard: {
          paddingVertical: s(14),
          paddingHorizontal: s(18),
          borderRadius: s(16),
        },
        totalLabel: { fontSize: ms(11), marginBottom: s(2) },
        totalHint: { fontSize: ms(11) },
        totalValue: { fontSize: ms(33) },

        payLabel: { fontSize: ms(10), marginBottom: s(9) },
        payGrid: { gap: s(9) },
        payBtn: {
          paddingVertical: s(11),
          paddingHorizontal: s(6),
          borderRadius: s(13),
          gap: s(6),
          minHeight: s(66),
        },
        payBtnTwoCol: { width: '48%' as const },
        payBtnOneCol: { flex: 1 },
        payIconWrap: {
          width: s(30),
          height: s(30),
          borderRadius: s(9),
        },
        payName: { fontSize: ms(11.5) },
        payCheck: {
          top: s(6),
          right: s(6),
          width: s(16),
          height: s(16),
          borderRadius: s(8),
        },

        confirmBtn: {
          gap: s(10),
          paddingVertical: s(15),
          borderRadius: s(15),
        },
        confirmText: { fontSize: ms(15.5) },
      }),
    [s, ms, width, height, cardWidth],
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
          para rolar a lista de itens seja confundido com "tocar fora" e feche. */}
      <View style={[styles.overlay, dyn.overlay]}>
        <View style={[styles.card, dyn.card]}>
          {/* Header */}
          <View style={[styles.header, dyn.header]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.headerKicker, dyn.headerKicker]}>
                Comanda
              </Text>
              <Text
                style={[styles.headerTitle, dyn.headerTitle]}
                numberOfLines={1}
              >
                {table?.name ?? 'Mesa'}
              </Text>
            </View>

            {!isEmpty && (
              <View style={[styles.headerBadge, dyn.headerBadge]}>
                <Feather name="shopping-bag" size={ms(12)} color={colors.amber} />
                <Text style={[styles.headerBadgeText, dyn.headerBadgeText]}>
                  {totalQty} {totalQty === 1 ? 'item' : 'itens'}
                </Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.closeBtn,
                dyn.closeBtn,
                pressed && styles.closeBtnPressed,
              ]}
              onPress={onClose}
              hitSlop={8}
              accessibilityLabel="Fechar"
            >
              <Feather name="x" size={ms(19)} color={colors.amber} />
            </Pressable>
          </View>

          {/* Lista de itens */}
          <ScrollView
            style={styles.list}
            contentContainerStyle={dyn.listContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            {isEmpty ? (
              <View style={[styles.emptyWrap, dyn.emptyWrap]}>
                <View style={[styles.emptyIcon, dyn.emptyIcon]}>
                  <Feather
                    name="coffee"
                    size={ms(28)}
                    color={colors.amberSoft}
                  />
                </View>
                <Text style={[styles.emptyTitle, dyn.emptyTitle]}>
                  Nenhum item nesta mesa
                </Text>
                <Text style={[styles.emptyText, dyn.emptyText]}>
                  Volte ao catálogo e toque nos produtos para lançar na comanda.
                </Text>
              </View>
            ) : (
              items.map((it) => (
                <View key={it.id} style={[styles.itemCard, dyn.itemCard]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={[styles.itemName, dyn.itemName]}
                      numberOfLines={1}
                    >
                      {it.name}
                    </Text>
                    <Text style={[styles.itemUnit, dyn.itemUnit]}>
                      {money(it.price)} / un
                    </Text>
                  </View>

                  {/* Stepper de quantidade (alvos >= s(34+) com hitSlop). */}
                  <View style={[styles.qtyControls, dyn.qtyControls]}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.stepBtn,
                        dyn.stepBtn,
                        pressed && styles.stepBtnPressed,
                      ]}
                      onPress={() => {
                        if (table) changeQty(table.id, it.id, -1);
                      }}
                      hitSlop={6}
                      accessibilityLabel={`Diminuir ${it.name}`}
                    >
                      <Feather
                        name={it.qty <= 1 ? 'trash-2' : 'minus'}
                        size={ms(15)}
                        color={it.qty <= 1 ? colors.danger : colors.textMuted}
                      />
                    </Pressable>
                    <Text style={[styles.qtyValue, dyn.qtyValue]}>{it.qty}</Text>
                    <Pressable
                      style={({ pressed }) => [
                        styles.stepBtn,
                        dyn.stepBtn,
                        pressed && styles.stepBtnPressed,
                      ]}
                      onPress={() => {
                        if (table) changeQty(table.id, it.id, 1);
                      }}
                      hitSlop={6}
                      accessibilityLabel={`Aumentar ${it.name}`}
                    >
                      <Feather name="plus" size={ms(15)} color={colors.textMuted} />
                    </Pressable>
                  </View>

                  <View style={[styles.subtotalPill, dyn.subtotalPill]}>
                    <Text style={[styles.itemSubtotal, dyn.itemSubtotal]}>
                      {money(it.price * it.qty)}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          {/* Rodapé: total + pagamento + confirmar */}
          <View style={[styles.footer, dyn.footer]}>
            <View style={[styles.totalCard, dyn.totalCard]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.totalLabel, dyn.totalLabel]}>Total</Text>
                <Text style={[styles.totalHint, dyn.totalHint]}>
                  {isEmpty
                    ? 'Sem itens'
                    : `${totalQty} ${totalQty === 1 ? 'item' : 'itens'}`}
                </Text>
              </View>
              <Text style={[styles.totalValue, dyn.totalValue]} numberOfLines={1}>
                {money(total)}
              </Text>
            </View>

            <View>
              <Text style={[styles.payLabel, dyn.payLabel]}>
                Forma de pagamento
              </Text>
              <View
                style={[
                  styles.payGrid,
                  dyn.payGrid,
                  payTwoCols && styles.payGridWrap,
                ]}
              >
                {PAYMENT_OPTIONS.map((pm) => {
                  const active = payment === pm.id;
                  return (
                    <Pressable
                      key={pm.id}
                      style={({ pressed }) => [
                        styles.payBtn,
                        dyn.payBtn,
                        payTwoCols ? dyn.payBtnTwoCol : dyn.payBtnOneCol,
                        active && styles.payBtnActive,
                        pressed && !active && styles.payBtnPressed,
                      ]}
                      onPress={() => setPayment(pm.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Pagar com ${pm.name}`}
                    >
                      <View
                        style={[
                          styles.payIconWrap,
                          dyn.payIconWrap,
                          active && styles.payIconWrapActive,
                        ]}
                      >
                        <Feather
                          name={PAY_ICON[pm.id]}
                          size={ms(15)}
                          color={active ? colors.woodHeader : colors.goldDeep}
                        />
                      </View>
                      <Text
                        style={[
                          styles.payName,
                          dyn.payName,
                          active && styles.payNameActive,
                        ]}
                      >
                        {pm.name}
                      </Text>
                      {active && (
                        <View style={[styles.payCheck, dyn.payCheck]}>
                          <Feather
                            name="check"
                            size={ms(10)}
                            color={colors.white}
                          />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.confirmBtn,
                dyn.confirmBtn,
                !canConfirm && styles.confirmBtnDisabled,
                canConfirm && pressed && styles.confirmBtnPressed,
              ]}
              onPress={confirm}
              disabled={!canConfirm}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canConfirm }}
            >
              <Feather
                name="check-circle"
                size={ms(19)}
                color={canConfirm ? colors.white : colors.textFaint}
              />
              <Text
                style={[
                  styles.confirmText,
                  dyn.confirmText,
                  !canConfirm && styles.confirmTextDisabled,
                ]}
              >
                {isEmpty
                  ? 'Adicione itens'
                  : payment === null
                    ? 'Escolha o pagamento'
                    : `Confirmar ${money(total)}`}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30,15,7,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    maxWidth: '100%',
    backgroundColor: colors.creamCard,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderCream,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.4,
    shadowRadius: 40,
    elevation: 24,
  },

  header: {
    backgroundColor: colors.woodHeader,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerKicker: {
    fontFamily: fonts.headingMedium,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: colors.amberSoft,
  },
  headerTitle: {
    fontFamily: fonts.heading,
    color: colors.creamText,
    marginTop: 2,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(232,199,122,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(232,199,122,0.28)',
  },
  headerBadgeText: {
    fontFamily: fonts.bodyBold,
    color: colors.amber,
  },
  closeBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnPressed: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },

  list: {
    flexGrow: 0,
    flexShrink: 1,
  },

  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    backgroundColor: colors.creamPanel,
    borderWidth: 1,
    borderColor: colors.borderCream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontFamily: fonts.heading,
    letterSpacing: 0.5,
    color: colors.textMuted,
    textAlign: 'center',
  },
  emptyText: {
    color: colors.textFaint,
    fontFamily: fonts.body,
    textAlign: 'center',
    lineHeight: 18,
  },

  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.creamPanel,
    borderWidth: 1,
    borderColor: colors.borderCream,
  },
  itemName: {
    fontFamily: fonts.bodyBold,
    color: colors.textHeading,
  },
  itemUnit: {
    color: colors.goldDeepAlt,
    fontFamily: fonts.body,
  },

  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderCreamSoft,
  },
  stepBtn: {
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnPressed: {
    backgroundColor: colors.creamDeep,
  },
  qtyValue: {
    fontFamily: fonts.heading,
    textAlign: 'center',
    color: colors.textHeading,
  },

  subtotalPill: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderCream,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  itemSubtotal: {
    fontFamily: fonts.heading,
    color: colors.textHeading,
    textAlign: 'right',
  },

  footer: {
    borderTopWidth: 1,
    borderTopColor: '#EAD9B6',
    backgroundColor: colors.creamCard,
  },

  totalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.woodHeader,
  },
  totalLabel: {
    fontFamily: fonts.heading,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.amberSoft,
  },
  totalHint: {
    fontFamily: fonts.body,
    color: colors.amber,
    opacity: 0.85,
  },
  totalValue: {
    fontFamily: fonts.headingBold,
    color: colors.creamText,
  },

  payLabel: {
    fontFamily: fonts.heading,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.goldDeepAlt,
  },
  payGrid: {
    flexDirection: 'row',
  },
  payGridWrap: {
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  payBtn: {
    borderWidth: 1.5,
    borderColor: colors.borderCreamSoft,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payBtnActive: {
    borderColor: colors.gold,
    backgroundColor: colors.amber,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 5,
  },
  payBtnPressed: {
    backgroundColor: colors.creamAlt,
  },
  payIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.creamPanel,
  },
  payIconWrapActive: {
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  payName: {
    fontFamily: fonts.bodyBold,
    color: colors.textMuted,
  },
  payNameActive: {
    color: colors.textDark,
  },
  payCheck: {
    position: 'absolute',
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },

  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.success,
    shadowColor: colors.success,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 8,
  },
  confirmBtnPressed: {
    backgroundColor: '#276B2A',
  },
  confirmBtnDisabled: {
    backgroundColor: colors.creamDeep,
    shadowOpacity: 0,
    elevation: 0,
  },
  confirmText: {
    fontFamily: fonts.heading,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.white,
  },
  confirmTextDisabled: {
    color: colors.textFaint,
  },
});
