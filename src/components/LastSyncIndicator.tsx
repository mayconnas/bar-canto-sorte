/**
 * LastSyncIndicator — indicador compacto do status de sincronização + "quando foi
 * a última sync". Substitui/complementa o SyncBadge no header do PDV.
 *
 * O que mostra:
 *  - Ícone + cor por status (getSyncStatus):
 *      synced   -> check-circle verde  ("Sincronizado")
 *      syncing  -> refresh-cw girando  ("Sincronizando")
 *      offline  -> cloud-off âmbar      ("Offline")
 *      error    -> alert-triangle vermelho ("Erro na sincronização")
 *      disabled -> hard-drive cinza     ("Somente local")
 *  - O "quando" formatado via formatLastSync / formatLastSyncShort + getLastSyncedAt.
 *
 * Auto-atualização:
 *  - Um setInterval (~30s) força re-render, relendo getSyncStatus()/getLastSyncedAt(),
 *    para o texto relativo ("há 2 min") envelhecer sozinho. O timer é limpo no unmount.
 *
 * Variantes (prop `compact`):
 *  - compact (default): ícone + texto curto ("há 2 min") — cabe no header.
 *  - full: rótulo "Última sincronização" + status + detalhe — para telas com espaço.
 *
 * Interação:
 *  - `onPress` opcional: se passado, o indicador vira tocável e, ao tocar, dispara
 *    o callback. Um atalho comum é forçar `processQueue()`; para isso, basta passar
 *    a prop `forceSyncOnPress` (chama processQueue internamente) OU seu próprio onPress.
 *
 * Puro em relação ao layout: StyleSheet + tema, tipado, pt-BR.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors } from '../theme/colors';
import { fonts } from '../theme/typography';
import type { SyncStatus } from '../types';
import { getLastSyncedAt, getSyncStatus, processQueue } from '../sync/syncEngine';
import { formatLastSync, formatLastSyncShort } from '../sync/syncTime';

/** Intervalo de auto-atualização do texto relativo (ms). */
const TICK_MS = 30 * 1000;

interface StatusVisual {
  /** Rótulo do estado (variante full / accessibility). */
  label: string;
  /** Ícone Feather. */
  icon: keyof typeof Feather.glyphMap;
  /** Cor de destaque do ícone/texto. */
  color: string;
}

/** Aparência por status. */
const STATUS_VISUAL: Record<SyncStatus, StatusVisual> = {
  synced: { label: 'Sincronizado', icon: 'check-circle', color: colors.success },
  syncing: { label: 'Sincronizando', icon: 'refresh-cw', color: colors.gold },
  offline: { label: 'Offline', icon: 'cloud-off', color: colors.amberSoft },
  error: { label: 'Erro na sincronização', icon: 'alert-triangle', color: colors.danger },
  disabled: { label: 'Somente local', icon: 'hard-drive', color: colors.textFaint },
};

export interface LastSyncIndicatorProps {
  /** true = variante enxuta (ícone + "há 2 min"); false/omitido = variante full. */
  compact?: boolean;
  /**
   * Callback ao tocar. Se informado, o indicador vira tocável. Tem precedência
   * sobre `forceSyncOnPress` — se você passar onPress, ele é quem roda.
   */
  onPress?: () => void;
  /**
   * Atalho: ao tocar, chama processQueue() do syncEngine para forçar uma sync.
   * Ignorado se `onPress` for passado. Útil como "toque para sincronizar agora".
   */
  forceSyncOnPress?: boolean;
  /** Estilo extra do container externo. */
  style?: StyleProp<ViewStyle>;
  /**
   * Fundo do "chip" (variante compact). Default: leve véu escuro para header
   * de madeira. Passe 'transparent' para embutir sem cápsula.
   */
  chipBackground?: string;
}

/**
 * Hook: dispara re-render periódico (~TICK_MS) para que o texto relativo
 * envelheça sozinho. Retorna um contador que muda a cada tick.
 */
function useTicker(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => (t + 1) % 1_000_000);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return tick;
}

/**
 * Ícone com rotação contínua quando `spinning` é true (estado 'syncing').
 * Anima em JS (useNativeDriver) e para/zera quando não está sincronizando.
 */
function SpinnableIcon({
  icon,
  color,
  size,
  spinning,
}: {
  icon: keyof typeof Feather.glyphMap;
  color: string;
  size: number;
  spinning: boolean;
}): React.ReactElement {
  const spin = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (spinning) {
      spin.setValue(0);
      const loop = Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      loopRef.current = loop;
      loop.start();
    } else {
      loopRef.current?.stop();
      loopRef.current = null;
      spin.setValue(0);
    }
    return () => {
      loopRef.current?.stop();
      loopRef.current = null;
    };
  }, [spinning, spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View style={spinning ? { transform: [{ rotate }] } : undefined}>
      <Feather name={icon} size={size} color={color} />
    </Animated.View>
  );
}

/**
 * Indicador de última sincronização. Lê status/timestamp do syncEngine a cada
 * render (e a cada ~30s via ticker), então não precisa de props de estado.
 */
export default function LastSyncIndicator({
  compact = false,
  onPress,
  forceSyncOnPress = false,
  style,
  chipBackground = 'rgba(0,0,0,0.18)',
}: LastSyncIndicatorProps): React.ReactElement {
  // Força re-render periódico p/ envelhecer o texto relativo.
  useTicker(TICK_MS);

  // Leitura síncrona do estado atual a cada render.
  const status: SyncStatus = getSyncStatus();
  const lastSyncedAt = getLastSyncedAt();
  const visual = STATUS_VISUAL[status] ?? STATUS_VISUAL.disabled;
  const spinning = status === 'syncing';

  // Resolve a ação de toque (onPress tem precedência sobre forceSyncOnPress).
  const handlePress = onPress ?? (forceSyncOnPress ? () => void processQueue() : undefined);
  const pressable = handlePress !== undefined;

  // ── Variante COMPACT: ícone + texto curto ("há 2 min") ────────────────────
  if (compact) {
    // Quando desabilitado (modo local), o "quando" não faz sentido: mostra o rótulo.
    const shortWhen =
      status === 'disabled'
        ? 'Local'
        : status === 'syncing'
        ? 'agora'
        : formatLastSyncShort(lastSyncedAt);

    const body = (
      <View style={[styles.chip, { backgroundColor: chipBackground }, style]}>
        <SpinnableIcon icon={visual.icon} color={visual.color} size={12} spinning={spinning} />
        <Text style={[styles.chipText, { color: visual.color }]} numberOfLines={1}>
          {shortWhen}
        </Text>
      </View>
    );

    if (!pressable) return body;
    return (
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`${visual.label}. ${formatLastSync(lastSyncedAt)}. Toque para sincronizar.`}
        style={({ pressed }) => (pressed ? styles.pressed : undefined)}
        hitSlop={6}
      >
        {body}
      </Pressable>
    );
  }

  // ── Variante FULL: rótulo + status + detalhe ──────────────────────────────
  const detail =
    status === 'disabled' ? 'App em modo somente local' : formatLastSync(lastSyncedAt);

  const fullBody = (
    <View style={[styles.fullRow, style]}>
      <View style={[styles.iconBubble, { borderColor: visual.color }]}>
        <SpinnableIcon icon={visual.icon} color={visual.color} size={16} spinning={spinning} />
      </View>
      <View style={styles.fullTextCol}>
        <Text style={styles.fullLabel} numberOfLines={1}>
          Última sincronização
        </Text>
        <Text style={[styles.fullDetail, { color: visual.color }]} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {pressable ? (
        <Feather name="refresh-cw" size={16} color={colors.textFaint} style={styles.fullAction} />
      ) : null}
    </View>
  );

  if (!pressable) return fullBody;
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${visual.label}. ${detail}. Toque para sincronizar agora.`}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {fullBody}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Compact
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  chipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 0.2,
  },

  // Full
  fullRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.borderCream,
    alignSelf: 'flex-start',
  },
  iconBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  fullTextCol: {
    flexShrink: 1,
  },
  fullLabel: {
    fontFamily: fonts.headingMedium,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  fullDetail: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    marginTop: 1,
  },
  fullAction: {
    marginLeft: 4,
  },

  pressed: {
    opacity: 0.6,
  },
});
