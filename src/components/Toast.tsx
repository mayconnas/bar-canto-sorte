/**
 * Toast — balão de feedback fixo embaixo/centro da tela.
 * Lê `toast` direto do usePdvStore e anima a opacidade (fade in/out).
 * Some sozinho porque o próprio store limpa `toast` após ~1900ms (flash()).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/typography';
import { usePdvStore } from '../store/usePdvStore';

const FADE_MS = 220;

export default function Toast() {
  const toast = usePdvStore((s) => s.toast);

  // Mantém o último texto visível durante o fade-out (o store já limpou
  // `toast` para '', mas a UI ainda precisa mostrar a mensagem sumindo).
  const [message, setMessage] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (toast) {
      setMessage(toast);
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_MS,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }).start(() => setMessage(''));
    }
  }, [toast, opacity]);

  if (!message) return null;

  return (
    <View style={styles.wrapper} pointerEvents="none">
      <Animated.View style={[styles.bubble, { opacity }]}>
        <Text style={styles.text} numberOfLines={2}>
          {message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    alignItems: 'center',
    zIndex: 999,
  },
  bubble: {
    maxWidth: '86%',
    backgroundColor: colors.woodDark,
    borderColor: colors.gold,
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  text: {
    color: colors.amber,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    textAlign: 'center',
  },
});
