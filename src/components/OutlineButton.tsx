/**
 * OutlineButton — botão secundário (transparente, borda sólida).
 * Usado para ações como "Cancelar", abrir modais secundários, etc.
 */
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors } from '../theme/colors';
import { fonts } from '../theme/typography';

interface OutlineButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
  disabled?: boolean;
  /** Usa tons claros (para fundos escuros, como a sidebar de madeira). */
  light?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function OutlineButton({
  label,
  onPress,
  icon,
  disabled,
  light,
  style,
}: OutlineButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        light ? styles.buttonLight : styles.buttonDark,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      <View style={styles.content}>
        {icon ? (
          <Feather
            name={icon}
            size={15}
            color={light ? colors.amber : colors.textMuted}
            style={styles.icon}
          />
        ) : null}
        <Text
          style={[styles.label, light ? styles.labelLight : styles.labelDark]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 11,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  buttonDark: {
    borderColor: colors.borderCreamSoft,
  },
  buttonLight: {
    borderColor: colors.goldLight,
  },
  buttonPressed: {
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginRight: 8,
  },
  label: {
    fontFamily: fonts.heading,
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  labelDark: {
    color: colors.textMuted,
  },
  labelLight: {
    color: colors.amber,
  },
});
