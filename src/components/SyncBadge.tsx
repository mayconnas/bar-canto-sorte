/**
 * SyncBadge — indicador pequeno do status de sincronização (ícone + texto).
 * Lê `syncStatus` do usePdvStore (atualizado periodicamente por refreshSyncBadge).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors } from '../theme/colors';
import { fonts } from '../theme/typography';
import { usePdvStore } from '../store/usePdvStore';
import type { SyncStatus } from '../types';

interface StatusConfig {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
}

const STATUS_CONFIG: Record<SyncStatus, StatusConfig> = {
  disabled: { label: 'Local', icon: 'hard-drive', color: colors.textFaint },
  offline: { label: 'Offline', icon: 'cloud-off', color: colors.amberSoft },
  syncing: { label: 'Sincronizando', icon: 'refresh-cw', color: colors.gold },
  synced: { label: 'Sincronizado', icon: 'check-circle', color: colors.success },
  error: { label: 'Erro sync', icon: 'alert-triangle', color: colors.danger },
};

export default function SyncBadge() {
  const syncStatus = usePdvStore((s) => s.syncStatus);
  const config = STATUS_CONFIG[syncStatus] ?? STATUS_CONFIG.disabled;

  return (
    <View style={styles.wrapper}>
      <Feather name={config.icon} size={12} color={config.color} />
      <Text style={[styles.text, { color: config.color }]} numberOfLines={1}>
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
