/**
 * Modal "Nova Mesa" — abre uma comanda.
 *
 * Segue o mockup: overlay escuro com blur simulado, card creme arredondado,
 * header em degradê madeira, campo "Nome da mesa" com sugestão "Mesa NN" e
 * botões Cancelar / Adicionar. Fechar tocando no overlay ou no X.
 *
 * A criação em si (persistência + numeração real) é do store/banco; aqui o
 * nome digitado é apenas um rótulo opcional — em branco o banco usa "Mesa NN".
 *
 * ESCALA RESPONSIVA: fontes/paddings/dimensões passam por s()/ms() (useScale)
 * para não ficarem grandes demais ("zoom") em tablets; a largura do card é
 * acotada por Math.min(s(420), width - margem).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/typography';
import { usePdvStore } from '../../store/usePdvStore';
import { useScale } from '../../theme/scale';

interface AddTableModalProps {
  visible: boolean;
  onClose: () => void;
}

/** Deriva a sugestão "Mesa NN" a partir do maior número de mesa já aberto. */
function useSuggestedName(): string {
  const tables = usePdvStore((s) => s.tables);
  return useMemo(() => {
    let max = 0;
    for (const t of tables) {
      const n = parseInt(t.num, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    const next = String(max + 1).padStart(2, '0');
    return `Mesa ${next}`;
  }, [tables]);
}

export default function AddTableModal({ visible, onClose }: AddTableModalProps) {
  const addTable = usePdvStore((s) => s.addTable);
  const suggestedName = useSuggestedName();

  const { s, ms, width } = useScale();

  const [name, setName] = useState('');
  const inputRef = useRef<TextInput>(null);

  // Ao abrir: limpa o campo e foca o input.
  useEffect(() => {
    if (visible) {
      setName('');
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [visible]);

  const confirm = async () => {
    // Nome em branco -> banco atribui "Mesa NN" automaticamente.
    await addTable(name.trim() || undefined);
    onClose();
  };

  const dyn = useMemo(
    () =>
      StyleSheet.create({
        overlay: { padding: s(28) },
        card: {
          width: Math.min(s(420), width - s(40)),
          borderRadius: s(20),
        },
        header: {
          paddingVertical: s(20),
          paddingHorizontal: s(24),
        },
        headerKicker: { fontSize: ms(10) },
        headerTitle: { fontSize: ms(24), marginTop: s(2) },
        closeBtn: { width: s(38), height: s(38), borderRadius: s(10) },
        body: {
          paddingHorizontal: s(24),
          paddingTop: s(22),
          paddingBottom: s(24),
        },
        label: { fontSize: ms(11), marginBottom: s(8) },
        input: {
          paddingVertical: s(14),
          paddingHorizontal: s(14),
          borderRadius: s(12),
          fontSize: ms(18),
          minHeight: ms(48),
        },
        help: { fontSize: ms(12), marginTop: s(8), lineHeight: ms(17) },
        actions: { gap: s(10), marginTop: s(22) },
        cancelBtn: {
          paddingVertical: s(13),
          borderRadius: s(12),
          minHeight: ms(50),
        },
        cancelText: { fontSize: ms(14) },
        confirmBtn: {
          gap: s(8),
          paddingVertical: s(13),
          borderRadius: s(12),
          minHeight: ms(50),
        },
        confirmText: { fontSize: ms(14) },
      }),
    // s()/ms() são funções puras de `width` (já arredondado em useScale), então
    // basta `width`. Omitimos s/ms de propósito: na web, focar o input pode mudar
    // só a ALTURA da janela e recriar s/ms — se estivessem aqui, o estilo seria
    // recriado a cada tecla e o TextInput perderia o foco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width],
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Overlay = View (não Pressable): só o botão X / Cancelar fecha. */}
      <View style={[styles.overlay, dyn.overlay]}>
        <View style={[styles.card, dyn.card]}>
          {/* Header em degradê madeira (simulado com cor sólida woodHeader). */}
          <View style={[styles.header, dyn.header]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerKicker, dyn.headerKicker]}>
                Abrir comanda
              </Text>
              <Text style={[styles.headerTitle, dyn.headerTitle]}>Nova Mesa</Text>
            </View>
            <Pressable
              style={[styles.closeBtn, dyn.closeBtn]}
              onPress={onClose}
              hitSlop={8}
              accessibilityLabel="Fechar"
            >
              <Feather name="x" size={ms(18)} color={colors.amber} />
            </Pressable>
          </View>

          {/* Corpo */}
          <View style={[styles.body, dyn.body]}>
            <Text style={[styles.label, dyn.label]}>Nome da mesa</Text>
            <TextInput
              ref={inputRef}
              value={name}
              onChangeText={setName}
              onSubmitEditing={confirm}
              returnKeyType="done"
              placeholder={suggestedName}
              placeholderTextColor={colors.textFaint}
              maxLength={24}
              style={[styles.input, dyn.input]}
              selectionColor={colors.gold}
            />
            <Text style={[styles.help, dyn.help]}>
              Deixe em branco para usar o nome padrão (ex.: {suggestedName}).
            </Text>

            <View style={[styles.actions, dyn.actions]}>
              <Pressable
                style={({ pressed }) => [
                  styles.cancelBtn,
                  dyn.cancelBtn,
                  pressed && styles.cancelBtnPressed,
                ]}
                onPress={onClose}
              >
                <Text style={[styles.cancelText, dyn.cancelText]}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmBtn,
                  dyn.confirmBtn,
                  pressed && styles.confirmBtnPressed,
                ]}
                onPress={confirm}
              >
                <Feather name="plus" size={ms(17)} color={colors.creamCard} />
                <Text style={[styles.confirmText, dyn.confirmText]}>Adicionar</Text>
              </Pressable>
            </View>
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
  },
  closeBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {},
  label: {
    fontFamily: fonts.headingMedium,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: colors.goldDeepAlt,
  },
  input: {
    width: '100%',
    borderWidth: 1.5,
    borderColor: colors.borderCreamSoft,
    backgroundColor: colors.white,
    color: colors.textHeading,
    fontFamily: fonts.headingRegular,
  },
  help: {
    color: colors.textFaint,
    fontFamily: fonts.body,
  },
  actions: {
    flexDirection: 'row',
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.borderCreamSoft,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnPressed: {
    backgroundColor: colors.creamAlt,
  },
  cancelText: {
    fontFamily: fonts.heading,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  confirmBtn: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 8,
  },
  confirmBtnPressed: {
    backgroundColor: colors.goldDeep,
  },
  confirmText: {
    fontFamily: fonts.heading,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.creamCard,
  },
});
