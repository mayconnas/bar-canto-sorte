/**
 * MainScreen — o coração visual do PDV Canto da Sorte.
 *
 * Reproduz fielmente o mockup (PDV Canto da Sorte.dc.html): layout tablet
 * landscape em duas colunas — Mapa de Mesas (área principal, flex) + painel
 * lateral direito de lançamento (largura fixa ~340). Em telas estreitas o
 * painel lateral vira um "drawer" acionado por um botão flutuante, preservando
 * o fluxo de duas colunas quando há espaço.
 *
 * TODA a data e ações vêm do store (usePdvStore). Os modais (Adicionar Mesa,
 * Checkout, Gestão de Cardápio) são abertos pelo componente-pai via as props
 * onOpenAdd / onOpenCheckout / onOpenManage.
 *
 * RESPONSIVIDADE: todo tamanho que causa "zoom" (fontes, paddings, gaps,
 * dimensões de logo/cards/botões/ícones) é recalculado por s()/ms() do
 * useScale e aplicado via estilos dinâmicos criados com useMemo. Os estilos
 * ESTÁTICOS (cores, direção de flex, bordas de cor fixa) ficam no
 * StyleSheet.create de módulo. Assim, em telas menores TUDO encolhe
 * proporcionalmente, sem zoom e sem sobreposição.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { colors } from '../theme/colors';
import { fonts } from '../theme/typography';
import { useScale, type ScaleApi } from '../theme/scale';
import type { Product, Table } from '../types';
import {
  money,
  tableCount,
  tableTotal,
  useOccupiedCount,
  useProductsByActiveCategory,
  useSelectedTable,
  usePdvStore,
} from '../store/usePdvStore';
import { LastSyncIndicator } from '../components';
import SalesReportModal from '../components/modals/SalesReportModal';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MainScreenProps {
  /** Abre o modal "Nova Mesa". */
  onOpenAdd: () => void;
  /** Abre o modal de Checkout da mesa selecionada. */
  onOpenCheckout: () => void;
  /** Abre o modal de Gestão de Cardápio ("Produtos & Seções"). */
  onOpenManage: () => void;
}

// Abaixo desta largura, o painel lateral passa a ser um drawer sobreposto.
// 1000px: um tablet 10" em RETRATO (~800px) fica em modo drawer — o mapa de mesas
// usa a largura inteira (2 colunas confortáveis) em vez de dividir com o painel e
// espremer tudo. Em PAISAGEM (~1280px) volta às 2 colunas lado a lado.
const SIDEBAR_WIDTH = 344;
// Breakpoint em DP (não em pixels físicos!). useWindowDimensions retorna dp.
// Um tablet 10" (1280x800 físico, densidade ~1.6) reporta ~800dp em paisagem e
// ~500-600dp em retrato. Com 900 o modo 2-colunas ativa de forma confiável em
// PAISAGEM de tablet e em desktop, enquanto RETRATO/celular caem no drawer.
const TWO_COLUMN_MIN_WIDTH = 900;

// ===========================================================================
// Estilos DINÂMICOS — escalados pelo fator responsivo (useScale).
// ---------------------------------------------------------------------------
// makeDynStyles recebe s()/ms() e devolve um objeto de estilos JÁ escalados.
// É chamado DENTRO de cada componente via useMemo([s, ms]) porque o fator muda
// com a largura da janela. Os estilos estáticos (cor, flexDirection, bordas)
// vivem no StyleSheet.create de módulo (styles) e são combinados via array.
// ===========================================================================

type Dyn = ReturnType<typeof makeDynStyles>;

function makeDynStyles({ s, ms }: Pick<ScaleApi, 's' | 'ms'>) {
  return StyleSheet.create({
    // ---- Header (compacto: ocupa menos espaço vertical) ----
    header: {
      paddingHorizontal: s(20),
      paddingVertical: s(7),
      borderBottomWidth: Math.max(2, s(3)),
    },
    brandBlock: { gap: s(11) },
    zoomControl: {
      marginLeft: s(10),
      gap: s(4),
      paddingHorizontal: s(4),
      paddingVertical: s(3),
      borderRadius: s(11),
    },
    zoomBtn: {
      width: s(28),
      height: s(28),
      borderRadius: s(8),
    },
    zoomValue: {
      fontSize: ms(11),
      minWidth: s(34),
    },
    logoBox: { width: s(42), height: s(42), borderRadius: s(11) },
    brandTagline: { fontSize: ms(9), marginTop: s(2), letterSpacing: s(3) },
    headerRight: { gap: s(14) },
    headerRightCompact: { gap: s(9) },
    iconHeaderBtn: { width: s(42), height: s(42), borderRadius: s(12) },
    manageBtn: {
      gap: s(8),
      paddingHorizontal: s(15),
      paddingVertical: s(11),
      borderRadius: s(12),
    },
    manageBtnText: { fontSize: ms(12), letterSpacing: s(1.3) },
    headerDivider: { height: s(40), marginHorizontal: s(2) },
    headerStatLabel: { fontSize: ms(9), letterSpacing: s(1.8) },
    headerStatValue: { fontSize: ms(25) },
    headerStatValueCompact: { fontSize: ms(19) },
    headerStatFraction: { fontSize: ms(14) },

    // ---- Main (Mapa de Mesas) ----
    mainScrollContent: {
      paddingHorizontal: s(22),
      paddingTop: s(22),
      paddingBottom: s(14),
    },
    mainTitleRow: { gap: s(10), marginBottom: s(18) },
    mainTitle: { fontSize: ms(22), letterSpacing: s(1.2) },
    mainSubtitle: { fontSize: ms(13) },
    countPill: {
      paddingHorizontal: s(11),
      paddingVertical: s(4),
      borderRadius: s(20),
    },
    countPillText: { fontSize: ms(11), letterSpacing: s(0.6) },
    // Botão "Adicionar Mesa" no cabeçalho do mapa (alinhado à direita).
    mainHeaderAddBtn: {
      gap: s(7),
      paddingHorizontal: s(14),
      paddingVertical: s(9),
      borderRadius: s(11),
    },
    // Em telas estreitas o botão vira só ícone (sem rótulo) e fica quadrado.
    mainHeaderAddBtnIconOnly: { paddingHorizontal: s(9) },
    mainHeaderAddBtnText: { fontSize: ms(12), letterSpacing: s(0.8) },

    // ---- Card de mesa (compacto: ~30% menor que o design base) ----
    tableCard: { padding: s(5) },
    tableCardInner: { borderRadius: s(14), padding: s(11) },
    tableCardSelected: { padding: s(10) },
    numBadge: {
      minWidth: s(28),
      height: s(28),
      paddingHorizontal: s(6),
      borderRadius: s(8),
    },
    numBadgeText: { fontSize: ms(13) },
    tableNameRow: { marginTop: s(9), gap: s(6) },
    tableName: { fontSize: ms(14) },
    tableDivider: { marginTop: s(8), marginBottom: s(7) },
    tableCount: { fontSize: ms(11) },
    tableTotal: { fontSize: ms(14) },

    // ---- Estado vazio ----
    emptyCard: {
      marginTop: s(6),
      paddingVertical: s(46),
      paddingHorizontal: s(26),
      borderRadius: s(20),
      gap: s(15),
    },
    emptyIcon: { width: s(66), height: s(66), borderRadius: s(18) },
    emptyTitle: { fontSize: ms(20), letterSpacing: s(0.6) },
    emptySubtitle: { fontSize: ms(14), marginTop: s(5), maxWidth: s(340) },

    // ---- Rodapé ----
    footer: {
      gap: s(16),
      paddingHorizontal: s(22),
      paddingVertical: s(13),
    },
    footerLabel: { fontSize: ms(11), letterSpacing: s(1.3) },
    footerValue: { fontSize: ms(19), marginTop: s(2) },

    // ---- Botões ----
    goldBtn: {
      gap: s(9),
      paddingHorizontal: s(22),
      paddingVertical: s(13),
      borderRadius: s(13),
    },
    goldBtnText: { fontSize: ms(14), letterSpacing: s(1) },

    // ---- Zona Produtos (categorias + grade) ----
    tabsWrap: { paddingTop: s(14), paddingBottom: s(9) },
    tabsContent: { paddingHorizontal: s(14), gap: s(8) },
    tab: {
      paddingHorizontal: s(15),
      paddingVertical: s(9),
      borderRadius: s(22),
    },
    tabText: { fontSize: ms(12), letterSpacing: s(0.6) },
    // Grade de produtos (tiles compactos): o padding horizontal da grade + o
    // padding da célula formam o "gap" entre os tiles.
    productGridContent: {
      paddingHorizontal: s(9),
      paddingTop: s(4),
      paddingBottom: s(22),
    },
    productTileCell: { padding: s(5) },
    productTile: { padding: s(9), borderRadius: s(12), gap: s(6) },
    productTileIcon: { width: s(36), height: s(36), borderRadius: s(9) },
    productTileIconText: { fontSize: ms(16) },
    productTileName: { fontSize: ms(12.5), lineHeight: ms(16), minHeight: ms(32) },
    productTilePrice: { fontSize: ms(13.5), marginTop: s(1) },
    productTileAdd: { width: s(28), height: s(28), borderRadius: s(8) },
    // Stepper [ − qtd + ] no tile de produto (aparece com mesa + qty>0).
    stepper: { gap: s(3), paddingHorizontal: s(2), borderRadius: s(9) },
    stepBtn: { width: s(28), height: s(28), borderRadius: s(8) },
    stepQty: { fontSize: ms(13.5), minWidth: s(18) },

    // ---- Cabeçalho do painel "Lançar Itens" (nome da mesa + total) ----
    panelHeader: {
      paddingHorizontal: s(14),
      paddingTop: s(12),
      paddingBottom: s(10),
      gap: s(3),
    },
    panelHeaderLabel: { fontSize: ms(9), letterSpacing: s(1.8) },
    panelHeaderMesa: { fontSize: ms(15) },
    panelHeaderTotal: { fontSize: ms(15) },
    // Linha "Nome da mesa — Total" no header do drawer (retrato).
    drawerMesaLine: { fontSize: ms(12) },
    // ---- Editor inline do nome da mesa no header de "Lançar Itens" ----
    // (lápis discreto + input + salvar/cancelar). Vale no painel (2-colunas) e
    // no header do drawer (retrato).
    mesaEditPencil: { width: s(24), height: s(24), borderRadius: s(6), marginLeft: s(6) },
    mesaEditRowPanel: { gap: s(6) },
    mesaEditRowDrawer: { gap: s(6), marginTop: s(3) },
    mesaEditInputPanel: {
      paddingHorizontal: s(9),
      paddingVertical: s(5),
      borderRadius: s(8),
      fontSize: ms(15),
    },
    mesaEditInputDrawer: {
      paddingHorizontal: s(9),
      paddingVertical: s(4),
      borderRadius: s(8),
      fontSize: ms(13),
    },
    mesaEditSave: { width: s(30), height: s(30), borderRadius: s(8) },
    mesaEditCancel: { width: s(30), height: s(30), borderRadius: s(8) },
    drawerMesaRow: { marginTop: s(3) },

    emptyProducts: {
      fontSize: ms(13),
      paddingVertical: s(30),
      paddingHorizontal: s(12),
    },

    // ---- FAB / Drawer ----
    fab: {
      right: s(18),
      bottom: s(84),
      gap: s(8),
      paddingHorizontal: s(18),
      paddingVertical: s(13),
      borderRadius: s(28),
    },
    fabText: { fontSize: ms(14), letterSpacing: s(0.8) },
    drawerHeader: { paddingHorizontal: s(18), paddingVertical: s(15) },
    drawerTitle: { fontSize: ms(18), letterSpacing: s(0.8) },
    drawerClose: { width: s(36), height: s(36), borderRadius: s(10) },
  });
}

// ===========================================================================
// Componentes visuais reutilizáveis (inline — espelham ../components).
// A tela é autossuficiente: quando os componentes oficiais existirem, o visual
// permanece idêntico ao definido aqui.
// ===========================================================================

/** Selo de status Livre / Ocupada. */
function StatusPill({
  status,
  ms,
}: {
  status: Table['status'];
  ms: ScaleApi['ms'];
}): React.ReactElement {
  const occupied = status === 'ocupada';
  return (
    <View style={[styles.pill, occupied ? styles.pillOccupied : styles.pillFree]}>
      <View
        style={[styles.pillDot, occupied ? styles.pillDotOccupied : styles.pillDotFree]}
      />
      <Text
        style={[
          styles.pillText,
          { fontSize: ms(10) },
          occupied ? styles.pillTextOccupied : styles.pillTextFree,
        ]}
      >
        {occupied ? 'Ocupada' : 'Livre'}
      </Text>
    </View>
  );
}

/** Botão dourado (ação primária). */
function GoldButton({
  label,
  icon,
  onPress,
  disabled,
  style,
  dyn,
  iconSize,
}: {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  dyn: Dyn;
  iconSize: number;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.goldBtn,
        dyn.goldBtn,
        disabled && styles.goldBtnDisabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      {icon ? (
        <Feather
          name={icon}
          size={iconSize}
          color={disabled ? colors.textFaint : colors.creamCard}
        />
      ) : null}
      <Text
        style={[styles.goldBtnText, dyn.goldBtnText, disabled && styles.goldBtnTextDisabled]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ===========================================================================
// Card de mesa (grid do Mapa de Mesas).
// ===========================================================================

function TableCard({
  table,
  selected,
  onPress,
  widthStyle,
  dyn,
  ms,
}: {
  table: Table;
  selected: boolean;
  onPress: () => void;
  widthStyle: StyleProp<ViewStyle>;
  dyn: Dyn;
  ms: ScaleApi['ms'];
}): React.ReactElement {
  const count = tableCount(table);
  const total = tableTotal(table);
  const occupied = count > 0;

  return (
    <View style={[styles.tableCard, dyn.tableCard, widthStyle]}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.tableCardInner,
          dyn.tableCardInner,
          occupied && styles.tableCardOccupied,
          selected && styles.tableCardSelected,
          selected && dyn.tableCardSelected,
          pressed && styles.pressedCard,
        ]}
      >
        <View style={styles.tableCardTop}>
          <View
            style={[
              styles.numBadge,
              dyn.numBadge,
              occupied && styles.numBadgeOccupied,
              selected && styles.numBadgeSelected,
            ]}
          >
            <Text
              style={[
                styles.numBadgeText,
                dyn.numBadgeText,
                (occupied || selected) && styles.numBadgeTextSelected,
              ]}
            >
              {table.num}
            </Text>
          </View>
          <StatusPill status={occupied ? 'ocupada' : 'livre'} ms={ms} />
        </View>

        {/* Nome da mesa (somente leitura). A edição do nome foi movida para o
            header de "Lançar Itens" (painel/drawer), evitando toques acidentais
            no lápis ao selecionar a mesa. */}
        <View style={[styles.tableNameRow, dyn.tableNameRow]}>
          <Text style={[styles.tableName, dyn.tableName]} numberOfLines={1}>
            {table.name}
          </Text>
        </View>

        <View style={[styles.tableDivider, dyn.tableDivider]} />

        <View style={styles.tableCardBottom}>
          <Text style={[styles.tableCount, dyn.tableCount]} numberOfLines={1}>
            {count === 0 ? 'Sem itens' : count === 1 ? '1 item' : `${count} itens`}
          </Text>
          <Text
            style={[styles.tableTotal, dyn.tableTotal, occupied && styles.tableTotalActive]}
          >
            {money(total)}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

// ===========================================================================
// Linha de produto (lista do painel lateral).
// ===========================================================================

/** Ícone do produto: usa o emoji cadastrado ou a inicial do nome. */
function productGlyph(p: Product): string {
  if (p.icon && p.icon.trim().length > 0) return p.icon;
  const ch = p.name.trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

/**
 * Tile compacto de produto (célula da GRADE). Muito mais denso que a antiga
 * linha larga: ícone/foto pequeno + controle de quantidade numa linha, nome (até
 * 2 linhas) e preço embaixo. Assim cabem 2-3 colunas x várias linhas visíveis,
 * deixando o lançamento (ação primária do garçom) rápido e com muitos itens por
 * tela.
 *
 * CONTROLE DE QUANTIDADE: quando a mesa selecionada NÃO tem este produto (qty===0
 * ou nenhuma mesa selecionada) mostramos só o botão "+" (adiciona / dispara o
 * toast "Selecione uma mesa primeiro"). Quando qty>0 mostramos o stepper completo
 * [ − qtd + ]: "+" adiciona 1 (onAdd) e "−" remove 1 daquele item da comanda
 * (onRemove(itemId) → changeQty(tableId, itemId, -1); o store remove o item ao
 * chegar a 0). Cada botão é um Pressable aninhado com stopPropagation e onPress
 * próprio, para não disparar o toque do card inteiro.
 *
 * `widthStyle` define a largura da célula (ex.: 50% p/ 2 colunas, 33.33% p/ 3);
 * o padding da célula (dyn.productTileCell) cria o "gap" entre os tiles.
 */
function ProductTile({
  product,
  onAdd,
  onRemove,
  qty,
  itemId,
  widthStyle,
  dyn,
  ms,
}: {
  product: Product;
  onAdd: (p: Product) => void;
  /** Remove 1 unidade do item na mesa (changeQty(-1)). Só chamado com itemId. */
  onRemove: (itemId: string) => void;
  /** Quantidade já lançada deste produto na mesa selecionada (0 se nenhuma). */
  qty: number;
  /** id do OrderItem correspondente na comanda (para o "−"); undefined se qty===0. */
  itemId?: string;
  widthStyle: StyleProp<ViewStyle>;
  dyn: Dyn;
  ms: ScaleApi['ms'];
}): React.ReactElement {
  const unavailable = !product.available;
  return (
    <View style={[styles.productTileCell, dyn.productTileCell, widthStyle]}>
      <Pressable
        onPress={() => onAdd(product)}
        disabled={unavailable}
        style={({ pressed }) => [
          styles.productTile,
          dyn.productTile,
          unavailable && styles.productRowUnavailable,
          pressed && !unavailable && styles.productRowPressed,
        ]}
      >
        <View style={styles.productTileTop}>
          {product.imageUrl ? (
            <Image
              source={{ uri: product.imageUrl }}
              style={[styles.productIcon, dyn.productTileIcon]}
            />
          ) : (
            <View style={[styles.productIcon, dyn.productTileIcon]}>
              <Text style={[styles.productIconText, dyn.productTileIconText]}>
                {productGlyph(product)}
              </Text>
            </View>
          )}

          {unavailable ? (
            <View style={styles.soldOutTag}>
              <Text style={[styles.soldOutText, { fontSize: ms(9) }]}>Esgot.</Text>
            </View>
          ) : qty > 0 ? (
            // Stepper completo [ − qtd + ] (mesa selecionada e item já na comanda).
            <View style={[styles.stepper, dyn.stepper]}>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  if (itemId) onRemove(itemId);
                }}
                hitSlop={6}
                accessibilityLabel={`Remover ${product.name}`}
                style={({ pressed }) => [
                  styles.stepBtnMinus,
                  dyn.stepBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="minus" size={Math.round(ms(15))} color={colors.textMuted} />
              </Pressable>
              <Text style={[styles.stepQty, dyn.stepQty]} numberOfLines={1}>
                {qty}
              </Text>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  onAdd(product);
                }}
                hitSlop={6}
                accessibilityLabel={`Adicionar ${product.name}`}
                style={({ pressed }) => [
                  styles.stepBtnPlus,
                  dyn.stepBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="plus" size={Math.round(ms(15))} color={colors.creamCard} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onAdd(product);
              }}
              hitSlop={6}
              accessibilityLabel={`Adicionar ${product.name}`}
              style={({ pressed }) => [
                styles.addChip,
                dyn.productTileAdd,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="plus" size={Math.round(ms(15))} color={colors.creamCard} />
            </Pressable>
          )}
        </View>

        <Text style={[styles.productTileName, dyn.productTileName]} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={[styles.productPrice, dyn.productTilePrice]} numberOfLines={1}>
          {money(product.price)}
        </Text>
      </Pressable>
    </View>
  );
}

// ===========================================================================
// Editor inline do NOME da mesa selecionada — usado no cabeçalho de "Lançar
// Itens": no painel lateral (modo 2-colunas) e no header do drawer (retrato).
//
// A edição do nome ANTES ficava no card da mesa (fácil tocar no lápis sem
// querer ao selecionar). Agora vive só aqui, ao lado do nome no header:
//   - `hasSelection` => mostra o nome + um lápis discreto (Feather 'edit-2').
//   - Sem mesa selecionada => "Selecione uma mesa" SEM lápis.
//   - Ao tocar no lápis, o nome vira um TextInput (foco automático) com botões
//     salvar (check, dourado) e cancelar (x). Salvar chama renameTable no store
//     se o texto (trim) não for vazio e diferente do atual.
//
// Estado local (editing/draft/ref) fica AQUI; `dyn` vem memoizado do pai
// (useMemo([s,ms])), então digitar não recria estilos nem tira o foco do input.
// ===========================================================================

function MesaNameEditor({
  selectedTable,
  total,
  variant,
  dyn,
  ms,
}: {
  selectedTable: Table | null;
  /** Total da mesa já formatado (money()). */
  total: string;
  /** 'panel' = header do painel (2-colunas); 'drawer' = header do drawer. */
  variant: 'panel' | 'drawer';
  dyn: Dyn;
  ms: ScaleApi['ms'];
}): React.ReactElement {
  const renameTable = usePdvStore((st) => st.renameTable);

  const hasSelection = !!selectedTable;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInput>(null);

  // Trocar/limpar a mesa selecionada encerra qualquer edição em curso.
  useEffect(() => {
    setEditing(false);
  }, [selectedTable?.id]);

  const startEdit = useCallback(() => {
    if (!selectedTable) return;
    setDraft(selectedTable.name);
    setEditing(true);
    // Foca logo após o input aparecer.
    setTimeout(() => inputRef.current?.focus(), 40);
  }, [selectedTable]);

  const saveEdit = useCallback(() => {
    if (selectedTable) {
      const trimmed = draft.trim();
      if (trimmed.length > 0 && trimmed !== selectedTable.name) {
        void renameTable(selectedTable.id, trimmed);
      }
    }
    setEditing(false);
  }, [draft, renameTable, selectedTable]);

  const cancelEdit = useCallback(() => setEditing(false), []);

  // Bloco de edição (input + salvar + cancelar) — idêntico nos dois contextos,
  // só muda a escala do input (fonte maior no painel, menor no drawer).
  const editRow = (
    <View
      style={[
        styles.mesaEditRow,
        variant === 'drawer' ? dyn.mesaEditRowDrawer : dyn.mesaEditRowPanel,
      ]}
    >
      <TextInput
        ref={inputRef}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={saveEdit}
        placeholder="Nome da mesa"
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.gold}
        maxLength={24}
        returnKeyType="done"
        style={[
          styles.mesaEditInput,
          variant === 'drawer' ? dyn.mesaEditInputDrawer : dyn.mesaEditInputPanel,
        ]}
      />
      <Pressable
        onPress={saveEdit}
        hitSlop={8}
        accessibilityLabel="Salvar nome da mesa"
        style={({ pressed }) => [styles.mesaEditSave, dyn.mesaEditSave, pressed && styles.pressed]}
      >
        <Feather name="check" size={Math.round(ms(15))} color={colors.creamCard} />
      </Pressable>
      <Pressable
        onPress={cancelEdit}
        hitSlop={8}
        accessibilityLabel="Cancelar edição do nome"
        style={({ pressed }) => [
          styles.mesaEditCancel,
          dyn.mesaEditCancel,
          pressed && styles.pressed,
        ]}
      >
        <Feather name="x" size={Math.round(ms(15))} color={colors.amberSoft} />
      </Pressable>
    </View>
  );

  // Lápis discreto — só com mesa selecionada. onPress próprio (não afeta a grade).
  const pencil = hasSelection ? (
    <Pressable
      onPress={startEdit}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityLabel="Editar nome da mesa"
      style={({ pressed }) => [
        styles.mesaEditPencil,
        dyn.mesaEditPencil,
        pressed && styles.pressed,
      ]}
    >
      <Feather name="edit-2" size={Math.round(ms(13))} color={colors.amber} />
    </Pressable>
  ) : null;

  if (variant === 'drawer') {
    // Header do drawer: "<Nome> — <Total>" numa linha + lápis ao lado.
    if (editing && hasSelection) return editRow;
    return (
      <View style={[styles.drawerMesaRow, dyn.drawerMesaRow]}>
        <Text style={[styles.drawerMesaLine, dyn.drawerMesaLine]} numberOfLines={1}>
          {(hasSelection ? selectedTable!.name : 'Selecione uma mesa') + ' — ' + total}
        </Text>
        {pencil}
      </View>
    );
  }

  // Header do painel (2-colunas): "<Nome>" + lápis à esquerda, "<Total>" à direita.
  if (editing && hasSelection) return editRow;
  return (
    <View style={styles.panelHeaderMesaRow}>
      <View style={styles.panelHeaderNameWrap}>
        <Text style={[styles.panelHeaderMesa, dyn.panelHeaderMesa]} numberOfLines={1}>
          {hasSelection ? selectedTable!.name : 'Selecione uma mesa'}
        </Text>
        {pencil}
      </View>
      <Text style={[styles.panelHeaderTotal, dyn.panelHeaderTotal]} numberOfLines={1}>
        {total}
      </Text>
    </View>
  );
}

// ===========================================================================
// Painel lateral direito (lançamento de itens: categorias + grade de produtos).
// ===========================================================================

function SidePanel({
  dyn,
  s,
  ms,
  panelWidth,
  inDrawer,
}: {
  dyn: Dyn;
  s: ScaleApi['s'];
  ms: ScaleApi['ms'];
  /** Largura fixa no modo 2-colunas; undefined => ocupa a largura disponível (drawer). */
  panelWidth?: number;
  /**
   * No drawer (retrato) o painel precisa PREENCHER a altura do drawerPanel para
   * que o ScrollView de produtos (flex:1) tenha um pai com altura e possa rolar.
   * No modo 2-colunas a altura já vem da linha pai (styles.body -> flex:1).
   */
  inDrawer?: boolean;
}): React.ReactElement {
  const sections = usePdvStore((st) => st.sections);
  const activeCategory = usePdvStore((st) => st.activeCategory);
  const setActiveCategory = usePdvStore((st) => st.setActiveCategory);
  const addProductToTable = usePdvStore((st) => st.addProductToTable);
  const changeQty = usePdvStore((st) => st.changeQty);

  const products = useProductsByActiveCategory();

  // Mesa selecionada → alimenta o header (nome + total) e o stepper por produto.
  const selectedTable = useSelectedTable();

  // Mapa productId -> { itemId, qty } montado UMA vez a partir da comanda da mesa
  // selecionada. Cada tile consulta O(1) para saber a quantidade já lançada e o
  // id do item (necessário para o "−" via changeQty). Sem mesa selecionada o mapa
  // fica vazio → todos os tiles mostram só o "+".
  const productMeta = useMemo(() => {
    const map = new Map<string, { itemId: string; qty: number }>();
    if (selectedTable) {
      for (const it of selectedTable.items) {
        const prev = map.get(it.productId);
        // Normalmente há 1 item por produto (o store incrementa o existente);
        // se houver mais de um, somamos a qty e removemos pelo 1º id.
        if (prev) map.set(it.productId, { itemId: prev.itemId, qty: prev.qty + it.qty });
        else map.set(it.productId, { itemId: it.id, qty: it.qty });
      }
    }
    return map;
  }, [selectedTable]);

  // "−": remove 1 unidade do item na mesa selecionada (o store remove ao chegar a 0).
  const handleRemove = useCallback(
    (itemId: string) => {
      if (selectedTable) void changeQty(selectedTable.id, itemId, -1);
    },
    [changeQty, selectedTable],
  );

  // GRADE DE PRODUTOS — nº de colunas pela largura DISPONÍVEL do painel (não da
  // tela): no modo 2-colunas usa panelWidth (painel estreito ~344dp => 2 col); no
  // drawer (retrato) usa a largura da tela (tablet ~800dp => 3 col; celular => 2).
  const { width: screenWidth } = useWindowDimensions();
  const availableWidth = panelWidth ?? screenWidth;
  const productColumns = availableWidth >= 560 ? 3 : 2;
  const productTileBasis: ViewStyle = { width: `${100 / productColumns}%` };

  return (
    <View
      style={[
        styles.side,
        panelWidth ? { width: panelWidth } : { width: '100%' },
        // No drawer, o painel precisa esticar até a altura do drawerPanel para
        // que a lista de produtos (ScrollView flex:1) receba altura e role.
        inDrawer && styles.sideInDrawer,
      ]}
    >
      {/* ---------------------------------------------------------------- */}
      {/* CABEÇALHO — "Lançar Itens" + <Nome da mesa> — <Total>.           */}
      {/* No modo 2-colunas fica no topo do painel; no drawer (retrato) o   */}
      {/* nome+total já aparece no header do próprio drawer, então aqui é    */}
      {/* omitido para não duplicar.                                        */}
      {/* ---------------------------------------------------------------- */}
      {!inDrawer ? (
        <View style={[styles.panelHeader, dyn.panelHeader]}>
          <Text style={[styles.panelHeaderLabel, dyn.panelHeaderLabel]} numberOfLines={1}>
            Lançar Itens
          </Text>
          <MesaNameEditor
            selectedTable={selectedTable}
            total={money(tableTotal(selectedTable))}
            variant="panel"
            dyn={dyn}
            ms={ms}
          />
        </View>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* ZONA PRODUTOS — categorias + grade de produtos. Ocupa TODO o      */}
      {/* painel (flex:1 + minHeight:0) para o ScrollView interno (flex:1)  */}
      {/* rolar por toda a altura disponível.                               */}
      {/* ---------------------------------------------------------------- */}
      <View style={styles.produtosZone}>
      {/* Abas de categorias */}
      <View style={[styles.tabsWrap, dyn.tabsWrap]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={dyn.tabsContent}
        >
          {sections.map((sec) => {
            const active = sec.id === activeCategory;
            return (
              <Pressable
                key={sec.id}
                onPress={() => setActiveCategory(sec.id)}
                style={({ pressed }) => [
                  styles.tab,
                  dyn.tab,
                  active && styles.tabActive,
                  pressed && !active && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.tabText, dyn.tabText, active && styles.tabTextActive]}
                >
                  {sec.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Grade rolável de produtos (múltiplas colunas) */}
      <ScrollView
        style={styles.productList}
        contentContainerStyle={[styles.productGrid, dyn.productGridContent]}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {products.length === 0 ? (
          <View style={styles.emptyProductsWrap}>
            <Feather name="inbox" size={Math.round(ms(26))} color={colors.amberSoft} />
            <Text style={[styles.emptyProducts, dyn.emptyProducts]}>
              {activeCategory
                ? 'Nenhum produto nesta seção.'
                : 'Cadastre seções e produtos em "Produtos & Seções".'}
            </Text>
          </View>
        ) : (
          products.map((p) => {
            const meta = productMeta.get(p.id);
            return (
              <ProductTile
                key={p.id}
                product={p}
                onAdd={addProductToTable}
                onRemove={handleRemove}
                qty={meta?.qty ?? 0}
                itemId={meta?.itemId}
                widthStyle={productTileBasis}
                dyn={dyn}
                ms={ms}
              />
            );
          })
        )}
      </ScrollView>
      </View>
    </View>
  );
}

// ===========================================================================
// MainScreen
// ===========================================================================

export default function MainScreen({
  onOpenAdd,
  onOpenCheckout,
  onOpenManage,
}: MainScreenProps): React.ReactElement {
  const { width, height } = useWindowDimensions();
  // Zoom manual do usuário (salvo no banco): multiplica a escala responsiva.
  const zoomFactor = usePdvStore((st) => st.zoomFactor);
  const zoomIn = usePdvStore((st) => st.zoomIn);
  const zoomOut = usePdvStore((st) => st.zoomOut);
  const { s, ms } = useScale(zoomFactor);
  const dyn = useMemo(() => makeDynStyles({ s, ms }), [s, ms]);

  // Paisagem = largura maior que altura. Em PAISAGEM (inclusive celular deitado,
  // ~640-800dp) usamos 2 colunas lado a lado: a altura é pequena, então um drawer
  // vertical que sobe de baixo fica quebrado/espremido. 2 colunas aproveitam a
  // largura. Só telas MUITO estreitas em paisagem (<640) e retrato caem no drawer.
  const isLandscape = width > height;
  const twoColumn =
    width >= TWO_COLUMN_MIN_WIDTH || (isLandscape && width >= 640);

  // Breakpoints do header: em telas estreitas o lado direito COMPACTA e a marca
  // reduz de tamanho, mas nunca quebra (sempre 1 linha cada).
  const compactHeader = width < 900; // esconde dividers e o rótulo do sync
  const narrowHeader = width < 600; // celular: marca menor + esconde 'Vendas do dia'
  // Botão "Adicionar Mesa" no cabeçalho do mapa: em telas estreitas vira só ícone
  // (sem rótulo) para não brigar por espaço com o título/subtítulo/contador.
  const compactAddBtn = width < 600;
  const brandBaseSize = narrowHeader ? 18 : compactHeader ? 20 : 23;
  const brandNameSize = ms(brandBaseSize);

  // Estado do drawer (só usado no layout estreito).
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Estado do modal de relatório de vendas.
  const [reportOpen, setReportOpen] = useState(false);

  const tables = usePdvStore((st) => st.tables);
  const salesTodayTotal = usePdvStore((st) => st.salesTodayTotal);
  const selectTable = usePdvStore((st) => st.selectTable);

  const occupied = useOccupiedCount();
  const selectedTable = useSelectedTable();

  const selectedHasItems = !!selectedTable && tableCount(selectedTable) > 0;

  // Largura do painel lateral ESCALADA (não fixa): num tablet ~800dp, 344 fixo
  // comia 43% da tela e sobrava pouco pro mapa (poucas colunas). Escalado por
  // s() (que já respeita o zoom), encolhe proporcionalmente e libera espaço.
  // Limitado a no máx. 42% da largura, para nunca dominar a tela.
  const sidebarWidth = twoColumn
    ? Math.min(Math.round(s(SIDEBAR_WIDTH)), Math.round(width * 0.42))
    : 0;

  // Quantas colunas cabem no grid de mesas (larguras em DP). Como os cards ficaram
  // ~30% menores, cabem MAIS colunas por linha (grid mais denso).
  //  - tablet paisagem (mapa ~520-620dp)  => 3-4 colunas
  //  - desktop largo                      => 5 colunas
  //  - retrato/celular estreito           => 2 (ou 1 em telas bem pequenas)
  const gridArea = twoColumn ? Math.max(0, width - sidebarWidth) : width;
  const gridColumns =
    gridArea >= 1040
      ? 5
      : gridArea >= 760
        ? 4
        : gridArea >= 420
          ? 3
          : gridArea >= 260
            ? 2
            : 1;
  const cardBasis: ViewStyle = {
    width: `${100 / gridColumns}%`,
  };

  // Tocar numa mesa (dois cliques):
  //  - 1º toque numa mesa NÃO selecionada => apenas seleciona (não abre nada).
  //  - 2º toque na mesa JÁ selecionada     => abre o checkout se tiver itens.
  const handleTablePress = useCallback(
    (table: Table) => {
      if (table.id !== selectedTable?.id) {
        selectTable(table.id);
        return;
      }
      if (tableCount(table) > 0) {
        onOpenCheckout();
      }
    },
    [onOpenCheckout, selectTable, selectedTable],
  );

  // Rótulo/valor do rodapé (mesa selecionada).
  const footLabel = selectedTable
    ? `Mesa selecionada — ${selectedTable.num}`
    : 'Nenhuma mesa selecionada';
  const footValue = selectedTable
    ? `${selectedTable.name} · ${money(tableTotal(selectedTable))}`
    : 'Toque em uma mesa no mapa';

  // 2-colunas: painel com largura fixa escalada. Drawer: ocupa a largura toda.
  const sidePanelFixed = (
    <SidePanel dyn={dyn} s={s} ms={ms} panelWidth={sidebarWidth} />
  );
  const sidePanelDrawer = <SidePanel dyn={dyn} s={s} ms={ms} inDrawer />;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.root}>
        {/* ---------------------------------------------------------------- */}
        {/* HEADER */}
        {/* ---------------------------------------------------------------- */}
        <View style={[styles.header, dyn.header]}>
          <View style={[styles.brandBlock, dyn.brandBlock]}>
            <View style={[styles.logoBox, dyn.logoBox]}>
              <Image
                source={require('../../assets/logo-canto-da-sorte.png')}
                style={styles.logoImg}
                resizeMode="cover"
              />
            </View>
            <View style={styles.brandText}>
              <Text
                style={[styles.brandName, { fontSize: brandNameSize }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                ellipsizeMode="clip"
              >
                Canto da Sorte
              </Text>
              <Text
                style={[styles.brandTagline, dyn.brandTagline]}
                numberOfLines={1}
                ellipsizeMode="clip"
              >
                BAR · DESDE 1988
              </Text>
            </View>

            {/* Controle de zoom manual (+/−) — ajusta a escala de toda a UI e
                salva a preferência no banco (persiste entre sessões). */}
            <View style={[styles.zoomControl, dyn.zoomControl]}>
              <Pressable
                onPress={zoomOut}
                hitSlop={8}
                accessibilityLabel="Diminuir zoom"
                style={({ pressed }) => [
                  styles.zoomBtn,
                  dyn.zoomBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="minus" size={Math.round(ms(15))} color={colors.amber} />
              </Pressable>
              <Text style={[styles.zoomValue, dyn.zoomValue]} numberOfLines={1}>
                {Math.round(zoomFactor * 100)}%
              </Text>
              <Pressable
                onPress={zoomIn}
                hitSlop={8}
                accessibilityLabel="Aumentar zoom"
                style={({ pressed }) => [
                  styles.zoomBtn,
                  dyn.zoomBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="plus" size={Math.round(ms(15))} color={colors.amber} />
              </Pressable>
            </View>
          </View>

          <View
            style={[
              styles.headerRight,
              dyn.headerRight,
              compactHeader && dyn.headerRightCompact,
            ]}
          >
            <Pressable
              onPress={onOpenManage}
              hitSlop={6}
              style={({ pressed }) => [
                twoColumn ? styles.manageBtn : styles.iconHeaderBtn,
                twoColumn ? dyn.manageBtn : dyn.iconHeaderBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="grid" size={Math.round(ms(16))} color={colors.amber} />
              {twoColumn ? (
                <Text style={[styles.manageBtnText, dyn.manageBtnText]} numberOfLines={1}>
                  Produtos & Seções
                </Text>
              ) : null}
            </Pressable>

            <Pressable
              onPress={() => setReportOpen(true)}
              style={({ pressed }) => [
                styles.iconHeaderBtn,
                dyn.iconHeaderBtn,
                pressed && styles.pressed,
              ]}
              hitSlop={8}
              accessibilityLabel="Relatório de vendas"
            >
              <Feather name="bar-chart-2" size={Math.round(ms(18))} color={colors.amber} />
            </Pressable>

            <LastSyncIndicator compact forceSyncOnPress />

            {compactHeader ? null : <View style={[styles.headerDivider, dyn.headerDivider]} />}

            {narrowHeader ? null : (
              <View style={styles.headerStat}>
                <Text style={[styles.headerStatLabel, dyn.headerStatLabel]} numberOfLines={1}>
                  Vendas do dia
                </Text>
                <Text
                  style={[
                    styles.headerStatValue,
                    dyn.headerStatValue,
                    compactHeader && dyn.headerStatValueCompact,
                  ]}
                  numberOfLines={1}
                >
                  {money(salesTodayTotal)}
                </Text>
              </View>
            )}

            {compactHeader ? null : <View style={[styles.headerDivider, dyn.headerDivider]} />}

            <View style={styles.headerStat}>
              <Text style={[styles.headerStatLabel, dyn.headerStatLabel]} numberOfLines={1}>
                Mesas ocupadas
              </Text>
              <Text
                style={[
                  styles.headerStatValue,
                  dyn.headerStatValue,
                  compactHeader && dyn.headerStatValueCompact,
                ]}
                numberOfLines={1}
              >
                {occupied}
                <Text style={[styles.headerStatFraction, dyn.headerStatFraction]}>
                  /{tables.length}
                </Text>
              </Text>
            </View>
          </View>
        </View>

        {/* ---------------------------------------------------------------- */}
        {/* CORPO: área principal + painel lateral */}
        {/* ---------------------------------------------------------------- */}
        <View style={styles.body}>
          {/* Área principal (Mapa de Mesas) */}
          <View style={styles.main}>
            <ScrollView
              style={styles.mainScroll}
              contentContainerStyle={dyn.mainScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={[styles.mainTitleRow, dyn.mainTitleRow]}>
                <Text style={[styles.mainTitle, dyn.mainTitle]}>Mapa de Mesas</Text>
                <Text style={[styles.mainSubtitle, dyn.mainSubtitle]}>
                  Toque em uma mesa para lançar itens
                </Text>
                {tables.length > 0 ? (
                  <View style={[styles.countPill, dyn.countPill]}>
                    <Text style={[styles.countPillText, dyn.countPillText]}>
                      {tables.length === 1 ? '1 mesa' : `${tables.length} mesas`}
                    </Text>
                  </View>
                ) : null}

                {/* Botão "Adicionar Mesa" — sempre visível, alinhado à direita
                    (marginLeft:auto). Em telas estreitas vira só ícone. */}
                <Pressable
                  onPress={onOpenAdd}
                  hitSlop={6}
                  accessibilityLabel="Adicionar mesa"
                  style={({ pressed }) => [
                    styles.mainHeaderAddBtn,
                    dyn.mainHeaderAddBtn,
                    compactAddBtn && dyn.mainHeaderAddBtnIconOnly,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="plus" size={Math.round(ms(16))} color={colors.creamCard} />
                  {compactAddBtn ? null : (
                    <Text
                      style={[styles.mainHeaderAddBtnText, dyn.mainHeaderAddBtnText]}
                      numberOfLines={1}
                    >
                      Adicionar Mesa
                    </Text>
                  )}
                </Pressable>
              </View>

              {tables.length === 0 ? (
                <View style={[styles.emptyCard, dyn.emptyCard]}>
                  <View style={[styles.emptyIcon, dyn.emptyIcon]}>
                    <Feather name="coffee" size={Math.round(ms(30))} color={colors.goldDeepAlt} />
                  </View>
                  <View style={styles.emptyTextBlock}>
                    <Text style={[styles.emptyTitle, dyn.emptyTitle]}>Nenhuma mesa aberta</Text>
                    <Text style={[styles.emptySubtitle, dyn.emptySubtitle]}>
                      Comece adicionando a primeira mesa para lançar os pedidos.
                    </Text>
                  </View>
                  <GoldButton
                    label="Adicionar Mesa"
                    icon="plus"
                    onPress={onOpenAdd}
                    style={styles.emptyButton}
                    dyn={dyn}
                    iconSize={Math.round(ms(18))}
                  />
                </View>
              ) : (
                <View style={styles.grid}>
                  {tables.map((t) => (
                    <TableCard
                      key={t.id}
                      table={t}
                      selected={t.id === selectedTable?.id}
                      onPress={() => handleTablePress(t)}
                      widthStyle={cardBasis}
                      dyn={dyn}
                      ms={ms}
                    />
                  ))}
                </View>
              )}
            </ScrollView>

            {/* Rodapé da área principal */}
            <View style={[styles.footer, dyn.footer]}>
              <View style={styles.footerInfo}>
                <Text style={[styles.footerLabel, dyn.footerLabel]} numberOfLines={1}>
                  {footLabel}
                </Text>
                <Text style={[styles.footerValue, dyn.footerValue]} numberOfLines={1}>
                  {footValue}
                </Text>
              </View>
              <GoldButton
                label="Finalizar Mesa"
                icon="check"
                onPress={onOpenCheckout}
                disabled={!selectedHasItems}
                style={styles.footerButton}
                dyn={dyn}
                iconSize={Math.round(ms(18))}
              />
            </View>
          </View>

          {/* Painel lateral fixo (duas colunas) */}
          {twoColumn ? sidePanelFixed : null}
        </View>

        {/* Botão flutuante para abrir o painel no layout estreito */}
        {!twoColumn ? (
          <Pressable
            onPress={() => setDrawerOpen(true)}
            style={({ pressed }) => [styles.fab, dyn.fab, pressed && styles.pressed]}
          >
            <Feather name="plus-circle" size={Math.round(ms(22))} color={colors.creamCard} />
            <Text style={[styles.fabText, dyn.fabText]}>Lançar</Text>
          </Pressable>
        ) : null}
        {/* O Toast global é renderizado uma única vez no App.tsx, por cima de tudo. */}
      </View>

      {/* Drawer do painel lateral (layout estreito) */}
      {!twoColumn ? (
        <Modal
          visible={drawerOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setDrawerOpen(false)}
        >
          {/*
            Layout do drawer em duas faixas verticais:
              1. Área de backdrop ACIMA do painel — só ela é Pressable (fecha ao
                 tocar fora). Fica separada do painel, então NÃO captura os gestos
                 de arraste da lista de produtos.
              2. O painel (drawerPanel) com ALTURA fixa em pixels, para que a
                 cadeia de altura chegue até o ScrollView de produtos e ele role.
            Nada de Pressable/onStartShouldSetResponder envolvendo o painel: isso
            travava o scroll interno.
          */}
          <View style={styles.drawerRoot}>
            <Pressable
              style={styles.drawerBackdrop}
              onPress={() => setDrawerOpen(false)}
            />
            <View style={[styles.drawerPanel, { height: Math.round(height * 0.8) }]}>
              <View style={[styles.drawerHeader, dyn.drawerHeader]}>
                <View style={styles.drawerHeaderText}>
                  <Text style={[styles.drawerTitle, dyn.drawerTitle]} numberOfLines={1}>
                    Lançar Itens
                  </Text>
                  <MesaNameEditor
                    selectedTable={selectedTable}
                    total={money(tableTotal(selectedTable))}
                    variant="drawer"
                    dyn={dyn}
                    ms={ms}
                  />
                </View>
                <Pressable
                  onPress={() => setDrawerOpen(false)}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.drawerClose,
                    dyn.drawerClose,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="x" size={Math.round(ms(18))} color={colors.amber} />
                </Pressable>
              </View>
              {sidePanelDrawer}
            </View>
          </View>
        </Modal>
      ) : null}

      {/* Modal de Relatório de Vendas */}
      <SalesReportModal
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
      />
    </SafeAreaView>
  );
}

// ===========================================================================
// Estilos ESTÁTICOS (cores, direção, bordas de cor fixa).
// Os tamanhos escaláveis vêm de makeDynStyles (dyn) e são combinados via array.
// ===========================================================================

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.woodDarkest,
  },
  root: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  pressed: {
    opacity: 0.82,
  },
  pressedCard: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },

  // ---- Header ----
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.woodHeader,
    borderBottomColor: colors.gold,
  },
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    flexGrow: 0,
    minWidth: 0,
  },
  zoomControl: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    borderWidth: 1,
    borderColor: 'rgba(200,127,20,0.4)',
    backgroundColor: 'rgba(200,127,20,0.10)',
  },
  zoomBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  zoomValue: {
    fontFamily: fonts.headingMedium,
    color: colors.amber,
    textAlign: 'center',
  },
  logoBox: {
    backgroundColor: colors.creamCard,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImg: {
    width: '100%',
    height: '100%',
  },
  brandText: {
    flexShrink: 1,
  },
  brandName: {
    fontFamily: fonts.brand,
    color: colors.amber,
  },
  brandTagline: {
    fontFamily: fonts.headingRegular,
    color: colors.amberSoft,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  iconHeaderBtn: {
    borderWidth: 1,
    borderColor: 'rgba(200,127,20,0.4)',
    backgroundColor: 'rgba(200,127,20,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(200,127,20,0.4)',
    backgroundColor: 'rgba(200,127,20,0.10)',
  },
  manageBtnText: {
    fontFamily: fonts.headingMedium,
    textTransform: 'uppercase',
    color: colors.amber,
  },
  headerDivider: {
    width: 1,
    backgroundColor: 'rgba(107,66,38,0.35)',
  },
  headerStat: {
    alignItems: 'flex-end',
  },
  headerStatLabel: {
    fontFamily: fonts.headingRegular,
    textTransform: 'uppercase',
    color: colors.amberSoft,
  },
  headerStatValue: {
    fontFamily: fonts.heading,
    color: colors.creamText,
  },
  headerStatFraction: {
    fontFamily: fonts.headingRegular,
    color: colors.amberSoft,
  },

  // ---- Body ----
  body: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },

  // ---- Main (Mapa de Mesas) ----
  main: {
    flex: 1,
    flexDirection: 'column',
    minWidth: 0,
  },
  mainScroll: {
    flex: 1,
  },
  mainTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  mainTitle: {
    fontFamily: fonts.heading,
    textTransform: 'uppercase',
    color: colors.textHeading,
  },
  mainSubtitle: {
    fontFamily: fonts.body,
    color: colors.textMuted,
  },
  countPill: {
    backgroundColor: colors.creamDeep,
    borderWidth: 1,
    borderColor: colors.borderCream,
  },
  countPillText: {
    fontFamily: fonts.headingMedium,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  // Botão "Adicionar Mesa" no cabeçalho do mapa (dourado, empurrado à direita).
  mainHeaderAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
    backgroundColor: colors.gold,
    shadowColor: colors.goldDeep,
    shadowOpacity: 0.28,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  mainHeaderAddBtnText: {
    fontFamily: fonts.heading,
    textTransform: 'uppercase',
    color: colors.creamCard,
  },

  // Estado vazio
  emptyCard: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.borderDashed,
    backgroundColor: 'rgba(235,219,187,0.35)',
    alignItems: 'center',
  },
  emptyIcon: {
    backgroundColor: colors.creamDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTextBlock: {
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: fonts.heading,
    color: colors.textHeading,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: fonts.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  emptyButton: {},

  // Grid de mesas
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tableCard: {
    // A largura vem de widthStyle (cardBasis); o padding cria o gap entre cards.
  },
  tableCardInner: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.borderCream,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  tableCardOccupied: {
    borderColor: colors.borderCreamSoft,
    backgroundColor: colors.creamPanel,
  },
  tableCardSelected: {
    borderColor: colors.gold,
    borderWidth: 2,
    backgroundColor: colors.creamCard,
    shadowColor: colors.gold,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },

  tableCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  numBadge: {
    backgroundColor: colors.creamDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numBadgeOccupied: {
    backgroundColor: colors.goldDeep,
  },
  numBadgeSelected: {
    backgroundColor: colors.gold,
  },
  numBadgeText: {
    fontFamily: fonts.heading,
    color: colors.goldDeepAlt,
  },
  numBadgeTextSelected: {
    color: colors.creamCard,
  },
  tableNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tableName: {
    flexShrink: 1,
    fontFamily: fonts.headingMedium,
    color: colors.textHeading,
  },
  tableDivider: {
    height: 1,
    backgroundColor: colors.borderCream,
  },
  tableCardBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  tableCount: {
    fontFamily: fonts.body,
    color: colors.textMuted,
    flexShrink: 1,
  },
  tableTotal: {
    fontFamily: fonts.heading,
    color: colors.textFaint,
  },
  tableTotalActive: {
    color: colors.goldDeepAlt,
  },

  // ---- Footer da área principal ----
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.creamDeep,
    borderTopWidth: 1,
    borderTopColor: colors.borderDashed,
  },
  footerInfo: {
    flexShrink: 1,
    minWidth: 0,
  },
  footerLabel: {
    fontFamily: fonts.headingRegular,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  footerValue: {
    fontFamily: fonts.heading,
    color: colors.textHeading,
  },
  footerButton: {
    flexShrink: 0,
  },

  // ---- Painel lateral ----
  side: {
    width: SIDEBAR_WIDTH,
    flexShrink: 0,
    backgroundColor: colors.woodHeader,
    flexDirection: 'column',
  },
  // No drawer: o painel estica até a altura do drawerPanel (pai com altura fixa),
  // dando ao ScrollView de produtos (flex:1) um pai com altura → a lista rola.
  sideInDrawer: {
    flex: 1,
    minHeight: 0,
  },

  // ---- Cabeçalho do painel "Lançar Itens" (nome da mesa + total) ----
  panelHeader: {
    flexDirection: 'column',
    borderBottomWidth: 1,
    borderBottomColor: colors.woodBorder,
  },
  panelHeaderLabel: {
    fontFamily: fonts.headingRegular,
    textTransform: 'uppercase',
    color: colors.amberSoft,
  },
  panelHeaderMesaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  panelHeaderMesa: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: fonts.heading,
    color: colors.amber,
  },
  panelHeaderTotal: {
    flexShrink: 0,
    fontFamily: fonts.heading,
    color: colors.gold,
  },
  // Nome + lápis agrupados à esquerda (o total fica à direita via space-between).
  panelHeaderNameWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },

  // ---- Editor inline do nome da mesa (header de "Lançar Itens") ----
  mesaEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mesaEditInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.creamCard,
    color: colors.textHeading,
    fontFamily: fonts.headingMedium,
  },
  mesaEditPencil: {
    flexShrink: 0,
    borderWidth: 1,
    borderColor: 'rgba(200,127,20,0.4)',
    backgroundColor: 'rgba(200,127,20,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mesaEditSave: {
    flexShrink: 0,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mesaEditCancel: {
    flexShrink: 0,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerMesaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // ---- Zona Produtos (categorias + grade) ----
  // Ocupa TODO o painel (flex:1). minHeight:0 é essencial para o ScrollView da
  // grade (flex:1) poder encolher e rolar dentro da altura disponível.
  produtosZone: {
    flex: 1,
    minHeight: 0,
  },

  // Abas de categorias
  tabsWrap: {},
  tab: {
    borderWidth: 1,
    borderColor: colors.woodBorder,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  tabActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  tabText: {
    fontFamily: fonts.headingMedium,
    color: colors.amberSoft,
  },
  tabTextActive: {
    color: colors.woodDark,
  },

  // Grade de produtos
  productList: {
    flex: 1,
    minHeight: 0,
  },
  // Container da grade: linha com quebra (wrap). Cada célula tem largura % e o
  // padding da célula cria o gap; assim cabem 2-3 colunas x várias linhas.
  productGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
  },
  emptyProductsWrap: {
    // width 100% para ocupar a linha inteira da grade e centralizar de verdade.
    width: '100%',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  emptyProducts: {
    fontFamily: fonts.body,
    color: colors.amberSoft,
    textAlign: 'center',
  },
  // Célula da grade: a largura vem de widthStyle; o padding (dyn) cria o gap.
  productTileCell: {
    // largura definida inline via productTileBasis; padding via dyn.productTileCell.
  },
  // Tile compacto de produto. flex:1 faz o tile preencher a altura da célula
  // (que estica até a linha mais alta), mantendo os tiles alinhados.
  productTile: {
    flex: 1,
    flexDirection: 'column',
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.borderCream,
  },
  productTileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  productTileName: {
    fontFamily: fonts.bodyBold,
    color: colors.textHeading,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.borderCream,
  },
  productRowPressed: {
    backgroundColor: colors.creamAlt,
  },
  productRowUnavailable: {
    opacity: 0.55,
  },
  productIcon: {
    backgroundColor: colors.creamAlt,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  productIconText: {
    fontFamily: fonts.heading,
    color: colors.goldDeepAlt,
  },
  productInfo: {
    flex: 1,
    minWidth: 0,
  },
  productName: {
    fontFamily: fonts.bodyBold,
    color: colors.textHeading,
  },
  productPrice: {
    fontFamily: fonts.headingMedium,
    color: colors.goldDeepAlt,
  },
  addChip: {
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // Stepper [ − qtd + ] do tile de produto.
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  stepBtnPlus: {
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepBtnMinus: {
    backgroundColor: colors.creamDeep,
    borderWidth: 1,
    borderColor: colors.borderCream,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepQty: {
    fontFamily: fonts.heading,
    color: colors.textHeading,
    textAlign: 'center',
  },
  soldOutTag: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: colors.dangerBg,
  },
  soldOutText: {
    fontFamily: fonts.heading,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.danger,
  },

  // ---- Status pill ----
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
  },
  pillFree: {
    backgroundColor: colors.successBg,
  },
  pillOccupied: {
    backgroundColor: 'rgba(200,127,20,0.16)',
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pillDotFree: {
    backgroundColor: colors.success,
  },
  pillDotOccupied: {
    backgroundColor: colors.gold,
  },
  pillText: {
    fontFamily: fonts.heading,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  pillTextFree: {
    color: colors.success,
  },
  pillTextOccupied: {
    color: colors.goldDeep,
  },

  // ---- Botões reutilizáveis ----
  goldBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    shadowColor: colors.goldDeep,
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  goldBtnDisabled: {
    backgroundColor: colors.creamDeep,
    shadowOpacity: 0,
    elevation: 0,
  },
  goldBtnText: {
    fontFamily: fonts.heading,
    textTransform: 'uppercase',
    color: colors.creamCard,
  },
  goldBtnTextDisabled: {
    color: colors.textFaint,
  },

  // ---- FAB (layout estreito) ----
  fab: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gold,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  fabText: {
    fontFamily: fonts.heading,
    textTransform: 'uppercase',
    color: colors.creamCard,
  },

  // ---- Drawer (layout estreito) ----
  // Container do Modal: coluna que empurra o painel para baixo. O backdrop
  // (faixa superior) é flex:1 e clicável; o painel tem altura fixa (inline).
  drawerRoot: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'flex-end',
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,10,4,0.78)',
  },
  drawerPanel: {
    // A altura vem inline (height * 0.8, em pixels) — precisa ser ALTURA (não só
    // maxHeight) para que a cadeia flex chegue ao ScrollView de produtos e ele
    // role. flexShrink:0 evita que o painel encolha abaixo dessa altura.
    flexShrink: 0,
    backgroundColor: colors.woodHeader,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.woodBorder,
  },
  drawerHeaderText: {
    flexShrink: 1,
    minWidth: 0,
  },
  drawerTitle: {
    fontFamily: fonts.heading,
    textTransform: 'uppercase',
    color: colors.amber,
  },
  drawerMesaLine: {
    fontFamily: fonts.headingMedium,
    color: colors.amberSoft,
  },
  drawerClose: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
