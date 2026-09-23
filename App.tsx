/**
 * App.tsx — Entrypoint / integração do PDV Canto da Sorte.
 *
 * Responsabilidades:
 *  - Polyfill de URL (necessário para o supabase-js em React Native).
 *  - Carregar as fontes (Pacifico / Oswald / Manrope) via expo-font.
 *  - Inicializar o store (abre o banco SQLite local e liga o auto-sync).
 *  - Enquanto fontes ou store não estiverem prontos, mostra uma splash simples.
 *  - Montar a MainScreen dentro do SafeAreaProvider, controlando a
 *    visibilidade dos 3 modais (Nova Mesa / Checkout / Gestão de Cardápio)
 *    e renderizando o Toast global por cima de tudo.
 */
import 'react-native-url-polyfill/auto';

import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useFonts, Pacifico_400Regular } from '@expo-google-fonts/pacifico';
import {
  Oswald_400Regular,
  Oswald_500Medium,
  Oswald_600SemiBold,
  Oswald_700Bold,
} from '@expo-google-fonts/oswald';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';

import { colors } from './src/theme/colors';
import { fonts } from './src/theme/typography';
import { usePdvStore } from './src/store/usePdvStore';
import MainScreen from './src/screens/MainScreen';
import { Toast } from './src/components';
import AddTableModal from './src/components/modals/AddTableModal';
import CheckoutModal from './src/components/modals/CheckoutModal';
import ManageCatalogModal from './src/components/modals/ManageCatalogModal';

const LOGO = require('./assets/logo-canto-da-sorte.png');

/** Splash minimalista exibida enquanto fontes/banco carregam. */
function Splash({ withBrand }: { withBrand: boolean }) {
  return (
    <View style={styles.splash}>
      <Image source={LOGO} style={styles.splashLogo} resizeMode="contain" />
      {/* Só usamos a fonte de marca depois que as fontes carregaram. */}
      <Text style={[styles.splashTitle, withBrand && styles.splashTitleBrand]}>
        Canto da Sorte
      </Text>
      <Text style={styles.splashSub}>BAR · DESDE 1988</Text>
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Pacifico_400Regular,
    Oswald_400Regular,
    Oswald_500Medium,
    Oswald_600SemiBold,
    Oswald_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  const ready = usePdvStore((s) => s.ready);
  const init = usePdvStore((s) => s.init);
  const teardown = usePdvStore((s) => s.teardown);

  // Visibilidade dos 3 modais controlada aqui (pai), acionada pela MainScreen.
  const [addOpen, setAddOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    // Inicializa o store na montagem; init() é idempotente.
    void init();
    return () => {
      // Para timers/auto-sync no unmount (também ajuda no hot-reload).
      teardown();
    };
  }, [init, teardown]);

  const appReady = fontsLoaded && ready;

  if (!appReady) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Splash withBrand={fontsLoaded} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        <MainScreen
          onOpenAdd={() => setAddOpen(true)}
          onOpenCheckout={() => setCheckoutOpen(true)}
          onOpenManage={() => setManageOpen(true)}
        />

        <AddTableModal visible={addOpen} onClose={() => setAddOpen(false)} />
        <CheckoutModal
          visible={checkoutOpen}
          onClose={() => setCheckoutOpen(false)}
        />
        <ManageCatalogModal
          visible={manageOpen}
          onClose={() => setManageOpen(false)}
        />

        {/* Toast global — renderizado uma única vez, por cima de tudo. */}
        <Toast />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  splash: {
    flex: 1,
    backgroundColor: colors.woodDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  splashLogo: {
    width: 140,
    height: 140,
    marginBottom: 20,
  },
  splashTitle: {
    color: colors.amber,
    fontSize: 34,
    letterSpacing: 0.5,
  },
  splashTitleBrand: {
    fontFamily: fonts.brand,
  },
  splashSub: {
    color: colors.amberSoft,
    fontSize: 12,
    letterSpacing: 3,
    marginTop: 8,
  },
});
