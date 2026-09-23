/**
 * GoldButton — botão de ação primário (dourado sólido, texto Oswald uppercase).
 * Simula o gradiente dourado do mockup com backgroundColor + borda mais escura.
 */
import React from 'react';
import {
  ActivityIndicator,
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

interface GoldButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function GoldButton({
  label,
  onPress,
  icon,
  disabled,
  loading,
  style,
}: GoldButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={colors.creamCard}
            style={styles.icon}
          />
        ) : icon ? (
          <Feather
            name={icon}
            size={16}
            color={colors.creamCard}
            style={styles.icon}
          />
        ) : null}
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.goldDeep,
    paddingVertical: 12,
    paddingHorizontal: 18,
    shadowColor: colors.goldDeep,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  buttonPressed: {
    backgroundColor: colors.goldDeep,
  },
  buttonDisabled: {
    backgroundColor: colors.amberSoft,
    borderColor: colors.amberSoft,
    shadowOpacity: 0,
    elevation: 0,
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
    color: colors.creamCard,
    fontFamily: fonts.heading,
    fontSize: 14,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
