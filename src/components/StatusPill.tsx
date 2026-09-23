/**
 * StatusPill — selo de status da mesa ("LIVRE" / "OCUPADA").
 * Uppercase, fonte Oswald, cores coerentes com o tema.
 */
import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/typography';
import type { TableStatus } from '../types';

interface StatusPillProps {
  status: TableStatus;
  style?: ViewStyle;
}

export default function StatusPill({ status, style }: StatusPillProps) {
  const ocupada = status === 'ocupada';
  const label = ocupada ? 'Ocupada' : 'Livre';

  return (
    <View
      style={[
        styles.pill,
        ocupada ? styles.pillOcupada : styles.pillLivre,
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          ocupada ? styles.textOcupada : styles.textLivre,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  pillOcupada: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDeep,
  },
  pillLivre: {
    backgroundColor: colors.creamAlt,
    borderColor: colors.borderCreamSoft,
  },
  text: {
    fontFamily: fonts.heading,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  textOcupada: {
    color: colors.woodDark,
  },
  textLivre: {
    color: colors.textMuted,
  },
});
