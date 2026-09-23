/**
 * Modal "Produtos & Seções" — gestão do cardápio.
 *
 * O maior dos modais. Segue o mockup:
 *  - Coluna esquerda: lista de seções (selecionar / renomear inline / remover)
 *    + campo "Nova seção" com botão +.
 *  - Coluna direita: header da seção (nome + busca + "Novo produto"),
 *    formulário de cadastro/edição (nome, preço R$ com máscara, alternar
 *    Disponível/Esgotado, escolher seção) e lista de produtos da seção com
 *    badge (inicial), toggle de disponibilidade, preço, editar e remover.
 *  - Estados vazios: "Nenhuma seção ainda", "Nenhum produto nesta seção",
 *    "Nenhum produto encontrado".
 *  - Header com selo "Salvo automaticamente".
 *
 * Todas as mutações passam pelo store (que persiste no banco e sincroniza).
 *
 * RESPONSIVIDADE: todos os tamanhos passam por s()/ms() (ver theme/scale.ts).
 * Em PAISAGEM (largura >= 720) o corpo são DUAS COLUNAS: seções à esquerda,
 * produtos à direita. Em RETRATO (largura < 720, `stacked`) o corpo EMPILHA:
 *  - no topo, uma FAIXA HORIZONTAL rolável de chips ("Todos os produtos" + cada
 *    seção), com altura fixa pequena e a caixa "Nova seção" logo abaixo;
 *  - abaixo, ocupando o resto da altura, a ÁREA DE PRODUTOS (busca + "Novo
 *    produto" + formulário + lista rolável).
 * Em retrato o card tem ALTURA em PIXELS (~90% da tela via useScale().height)
 * para que a cadeia de flex tenha altura acotada e os ScrollView internos rolem.
 * Estilos dinâmicos são criados via useMemo dentro do componente.
 *
 * SCROLL: o overlay e o card são <View> simples (o modal só fecha pelo botão X),
 * então o arraste para rolar NUNCA é confundido com "tocar fora". Os ScrollView
 * internos são IRMÃOS (não aninhados) e usam nestedScrollEnabled. A cadeia de
 * altura em retrato: card (altura px) -> bodyRow (flex:1, minHeight:0) -> faixa
 * de seções (altura intrínseca) + área de produtos (flex:1, minHeight:0) ->
 * ScrollView (flex:1). Nada de onStartShouldSetResponder (travaria o scroll).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import type { Product } from '../../types';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/typography';
import { useScale } from '../../theme/scale';
import {
  money,
  usePdvStore,
  type NewProductDraft,
  type UpdateProductDraft,
} from '../../store/usePdvStore';
import { uploadProductImage } from '../../sync/imageUpload';
import { isSupabaseConfigured } from '../../config/env';

interface ManageCatalogModalProps {
  visible: boolean;
  onClose: () => void;
}

/** Rascunho do formulário de produto (novo ou edição). */
interface ProductForm {
  id: string | null; // null => novo produto
  name: string;
  price: string; // texto com máscara ("12,50")
  available: boolean;
  sectionId: string;
  imageUrl: string; // URL pública já enviada (Storage), ou '' se sem foto
  localImageUri: string; // URI local escolhida ainda não enviada (preview)
}

/** Tipo dos estilos memoizados (compartilhado com o ProductFormCard). */
type Styles = ReturnType<typeof createStyles>;

/** Converte um número de preço para o texto do input ("12.5" -> "12,50"). */
function priceToInput(n: number): string {
  return Number(n || 0)
    .toFixed(2)
    .replace('.', ',');
}

/** Máscara simples de preço: mantém dígitos + uma vírgula, no máx. 2 decimais. */
function maskPrice(raw: string): string {
  // Aceita dígitos, vírgula e ponto; normaliza ponto para vírgula.
  let s = raw.replace(/[^0-9.,]/g, '').replace(/\./g, ',');
  // Mantém apenas a primeira vírgula.
  const firstComma = s.indexOf(',');
  if (firstComma !== -1) {
    const intPart = s.slice(0, firstComma);
    const decPart = s.slice(firstComma + 1).replace(/,/g, '');
    s = intPart + ',' + decPart.slice(0, 2);
  }
  return s;
}

/** Converte o texto do input em número (aceita "12,50" ou "12.50"). */
function parsePrice(v: string): number {
  const n = parseFloat(String(v).replace(/[^0-9.,]/g, '').replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}

/** Inicial de exibição no badge do produto. */
function initialOf(name: string, icon?: string): string {
  const trimmedIcon = (icon ?? '').trim();
  if (trimmedIcon.length > 0) return trimmedIcon;
  const trimmedName = name.trim();
  return trimmedName.length > 0 ? trimmedName.charAt(0).toUpperCase() : '?';
}

export default function ManageCatalogModal({
  visible,
  onClose,
}: ManageCatalogModalProps) {
  const sections = usePdvStore((s) => s.sections);
  const products = usePdvStore((s) => s.products);
  const addSection = usePdvStore((s) => s.addSection);
  const renameSection = usePdvStore((s) => s.renameSection);
  const removeSection = usePdvStore((s) => s.removeSection);
  const addProduct = usePdvStore((s) => s.addProduct);
  const updateProduct = usePdvStore((s) => s.updateProduct);
  const removeProduct = usePdvStore((s) => s.removeProduct);
  const toggleAvailable = usePdvStore((s) => s.toggleAvailable);

  // Escala responsiva. width nos diz quando empilhar (celular estreito);
  // height dimensiona a altura do card em RETRATO (em pixels, para rolar).
  const { s, ms, width, height } = useScale();
  // Abaixo deste limiar não cabem duas colunas confortavelmente => empilha.
  const stacked = width < 720;
  // Os estilos só dependem de `width` (e do derivado `stacked`): s()/ms() são
  // funções PURAS de `width`, então basta `width` na lista de dependências.
  // Deixamos s/ms de fora de propósito — na web, focar um input pode alterar
  // apenas a ALTURA da janela (barra do navegador/teclado virtual), o que faz
  // useScale recriar s()/ms() com novas identidades. Se s/ms estivessem aqui,
  // o `styles` seria recriado (novo StyleSheet) a cada tecla e o TextInput
  // focado PERDERIA O FOCO. Dependendo só de `width`, isso não acontece.
  const styles = useMemo(
    () => createStyles(s, ms, width, stacked),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, stacked],
  );

  // Seção selecionada dentro do modal (independente da categoria do painel).
  // Valor especial 'ALL' = visão "Todos os produtos" (todas as seções juntas).
  const [manageCat, setManageCat] = useState<string | null>('ALL');
  const [draftSection, setDraftSection] = useState('');
  const [search, setSearch] = useState('');
  const [sectionEditId, setSectionEditId] = useState<string | null>(null);
  const [sectionEditLabel, setSectionEditLabel] = useState('');
  const [form, setForm] = useState<ProductForm | null>(null);

  const secInputRef = useRef<TextInput>(null);
  const productNameRef = useRef<TextInput>(null);

  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.position - b.position),
    [sections],
  );

  // Ao abrir (ou quando as seções mudam) garante uma seleção válida.
  // 'ALL' é sempre válido; caso contrário, a seção precisa existir.
  useEffect(() => {
    if (!visible) return;
    setManageCat((prev) => {
      if (prev === 'ALL') return prev;
      if (prev && sortedSections.some((s) => s.id === prev)) return prev;
      // Ao abrir, começa em "Todos os produtos".
      return 'ALL';
    });
  }, [visible, sortedSections]);

  // Ao fechar, limpa estados transitórios.
  useEffect(() => {
    if (!visible) {
      setDraftSection('');
      setSearch('');
      setSectionEditId(null);
      setForm(null);
    }
  }, [visible]);

  const isAll = manageCat === 'ALL';
  const currentSection = sortedSections.find((s) => s.id === manageCat) ?? null;
  const hasAnySection = sortedSections.length > 0;

  // Rótulo da seção de cada produto (para o badge na visão "Todos").
  const sectionLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of sortedSections) map[s.id] = s.label;
    return map;
  }, [sortedSections]);

  // Produtos exibidos: na visão "Todos", todos os produtos (ordenados por seção
  // e depois por posição); numa seção específica, só os dela.
  const sectionProducts = useMemo(() => {
    const secPos: Record<string, number> = {};
    sortedSections.forEach((s, i) => (secPos[s.id] = i));
    if (isAll) {
      return [...products].sort(
        (a, b) =>
          (secPos[a.sectionId] ?? 0) - (secPos[b.sectionId] ?? 0) ||
          a.position - b.position ||
          a.name.localeCompare(b.name),
      );
    }
    if (!manageCat) return [];
    return products
      .filter((p) => p.sectionId === manageCat)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }, [products, manageCat, isAll, sortedSections]);

  // Filtro de busca.
  const term = search.trim().toLowerCase();
  const visibleProducts = useMemo(() => {
    if (term.length === 0) return sectionProducts;
    return sectionProducts.filter((p) => p.name.toLowerCase().includes(term));
  }, [sectionProducts, term]);

  // Contagem de produtos por seção (para o subtítulo de cada seção).
  const countBySection = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products) {
      map[p.sectionId] = (map[p.sectionId] ?? 0) + 1;
    }
    return map;
  }, [products]);

  // --- Ações de seção -------------------------------------------------------

  const handleSelectSection = (id: string) => {
    setManageCat(id);
    setForm(null);
    setSectionEditId(null);
    setSearch('');
  };

  const handleAddSection = async () => {
    const label = draftSection.trim();
    if (!label) return;
    const created = await addSection(label);
    if (created) {
      setManageCat(created.id);
      setDraftSection('');
    }
  };

  const startRenameSection = (id: string, label: string) => {
    setSectionEditId(id);
    setSectionEditLabel(label);
    setForm(null);
    setTimeout(() => secInputRef.current?.focus(), 60);
  };

  const commitRenameSection = async () => {
    if (!sectionEditId) return;
    const label = sectionEditLabel.trim();
    if (label.length > 0) {
      await renameSection(sectionEditId, label);
    }
    setSectionEditId(null);
  };

  const handleRemoveSection = async (id: string) => {
    await removeSection(id);
    setManageCat((prev) => {
      if (prev !== id) return prev;
      const remaining = sortedSections.filter((s) => s.id !== id);
      return remaining.length > 0 ? remaining[0].id : null;
    });
    setForm(null);
  };

  // --- Ações de produto -----------------------------------------------------

  const startNewProduct = () => {
    // Na visão "Todos", o novo produto vai para a primeira seção por padrão
    // (o usuário pode trocar a seção no próprio formulário).
    const target = isAll ? sortedSections[0]?.id : manageCat;
    if (!target) return;
    setSectionEditId(null);
    setForm({
      id: null,
      name: '',
      price: '',
      available: true,
      sectionId: target,
      imageUrl: '',
      localImageUri: '',
    });
    setTimeout(() => productNameRef.current?.focus(), 60);
  };

  const startEditProduct = (p: Product) => {
    setSectionEditId(null);
    setForm({
      id: p.id,
      name: p.name,
      price: priceToInput(p.price),
      available: p.available,
      sectionId: p.sectionId,
      imageUrl: p.imageUrl ?? '',
      localImageUri: '',
    });
  };

  const cancelForm = () => setForm(null);
  const [uploading, setUploading] = useState(false);

  const flash = usePdvStore((s) => s.flash);

  const saveForm = async () => {
    if (!form || uploading) return;
    const name = form.name.trim();
    if (!name) return;
    const price = parsePrice(form.price);

    // Se o usuário escolheu uma nova foto local, envia ao Storage antes de salvar.
    let imageUrl = form.imageUrl;
    if (form.localImageUri) {
      try {
        setUploading(true);
        const seed = products.length + 1;
        const targetId = form.id ?? `new_${seed}`;
        imageUrl = await uploadProductImage(form.localImageUri, targetId, seed);
      } catch (err) {
        console.error('[upload foto]', err);
        flash('Não foi possível enviar a foto');
        setUploading(false);
        return;
      } finally {
        setUploading(false);
      }
    }

    if (form.id === null) {
      // Novo produto.
      const draft: NewProductDraft = {
        sectionId: form.sectionId,
        name,
        price,
        available: form.available,
        imageUrl,
      };
      const created = await addProduct(draft);
      if (created) {
        // Na visão "Todos", permanece em "Todos"; senão vai para a seção alvo.
        if (!isAll) setManageCat(form.sectionId);
        setForm(null);
      }
    } else {
      // Edição (pode mover de seção).
      const draft: UpdateProductDraft = {
        id: form.id,
        sectionId: form.sectionId,
        name,
        price,
        available: form.available,
        imageUrl,
      };
      await updateProduct(draft);
      if (!isAll) setManageCat(form.sectionId);
      setForm(null);
    }
  };

  // Abre câmera ou galeria e guarda o URI local no formulário (preview).
  const pickImage = async (fromCamera: boolean) => {
    if (!form) return;
    if (!isSupabaseConfigured()) {
      flash('Configure o Supabase para usar fotos');
      return;
    }
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        flash(
          fromCamera
            ? 'Permissão de câmera negada'
            : 'Permissão de galeria negada',
        );
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
          });
      if (!result.canceled && result.assets?.[0]?.uri) {
        setForm((f) => (f ? { ...f, localImageUri: result.assets[0].uri } : f));
      }
    } catch (err) {
      console.error('[pickImage]', err);
      flash('Não foi possível abrir a foto');
    }
  };

  // Botão de foto: dá a escolha entre câmera e galeria.
  const choosePhoto = () => {
    Alert.alert('Foto do produto', 'De onde você quer pegar a foto?', [
      { text: 'Câmera', onPress: () => pickImage(true) },
      { text: 'Galeria', onPress: () => pickImage(false) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const clearPhoto = () => {
    setForm((f) => (f ? { ...f, imageUrl: '', localImageUri: '' } : f));
  };

  const editingProductId = form && form.id !== null ? form.id : null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Overlay = View simples (NÃO Pressable): o modal só fecha pelo botão X.
          Assim o arraste para rolar as listas nunca é confundido com "tocar fora"
          e a tela não fecha sozinha ao scrollar. */}
      <View style={styles.overlay}>
        {/* Em RETRATO a altura vai por PIXELS (~90% da tela) via inline style —
            fora do StyleSheet memoizado — para atualizar ao rotacionar sem
            recriar os estilos (o que faria um TextInput focado perder o foco
            na web). Em paisagem mantém a altura de design do StyleSheet. */}
        <View
          style={[
            styles.card,
            stacked && { height: Math.round(height * 0.9) },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIcon}>
                <Feather name="grid" size={ms(20)} color={colors.amber} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.headerKicker}>Gestão do Cardápio</Text>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  Produtos & Seções
                </Text>
              </View>
            </View>
            <View style={styles.headerRight}>
              {!stacked ? (
                <View style={styles.savedBadge}>
                  <Feather
                    name="check"
                    size={ms(14)}
                    color={colors.successBorder}
                  />
                  <Text style={styles.savedText}>Salvo automaticamente</Text>
                </View>
              ) : null}
              <Pressable
                style={styles.closeBtn}
                onPress={onClose}
                hitSlop={8}
                accessibilityLabel="Fechar"
              >
                <Feather name="x" size={ms(18)} color={colors.amber} />
              </Pressable>
            </View>
          </View>

          {/* Corpo: em PAISAGEM duas colunas; em RETRATO empilha (faixa de
              seções no topo + área de produtos ocupando o resto). */}
          <View style={styles.bodyRow}>
            {stacked ? (
              /* ---- RETRATO: faixa horizontal de seções (chips) ---- */
              <View style={styles.sectionsStrip}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.stripContent}
                >
                  {/* Chip "Todos os produtos" (visão agregada). */}
                  <Pressable
                    style={({ pressed }) => [
                      styles.chip,
                      isAll && styles.chipActive,
                      pressed && styles.pressedSoft,
                    ]}
                    onPress={() => {
                      setManageCat('ALL');
                      setForm(null);
                      setSectionEditId(null);
                      setSearch('');
                    }}
                  >
                    <Feather
                      name="menu"
                      size={ms(15)}
                      color={isAll ? colors.creamCard : colors.goldDeepAlt}
                    />
                    <Text
                      style={[styles.chipLabel, isAll && styles.chipLabelActive]}
                      numberOfLines={1}
                    >
                      Todos os produtos
                    </Text>
                    <Text
                      style={[styles.chipCount, isAll && styles.chipCountActive]}
                    >
                      {products.length}
                    </Text>
                  </Pressable>

                  {sortedSections.length === 0 ? (
                    <Text style={styles.stripEmpty}>Nenhuma seção ainda</Text>
                  ) : (
                    sortedSections.map((sec) => {
                      const active = sec.id === manageCat;
                      const editing = sec.id === sectionEditId;
                      const count = countBySection[sec.id] ?? 0;
                      return (
                        <View
                          key={sec.id}
                          style={[styles.chip, active && styles.chipActive]}
                        >
                          {editing ? (
                            <TextInput
                              ref={secInputRef}
                              value={sectionEditLabel}
                              onChangeText={setSectionEditLabel}
                              onSubmitEditing={commitRenameSection}
                              onBlur={commitRenameSection}
                              returnKeyType="done"
                              maxLength={22}
                              style={styles.chipEditInput}
                              selectionColor={colors.gold}
                            />
                          ) : (
                            <>
                              <Pressable
                                style={styles.chipSelect}
                                onPress={() => handleSelectSection(sec.id)}
                              >
                                <Text
                                  style={[
                                    styles.chipLabel,
                                    active && styles.chipLabelActive,
                                  ]}
                                  numberOfLines={1}
                                >
                                  {sec.label}
                                </Text>
                                <Text
                                  style={[
                                    styles.chipCount,
                                    active && styles.chipCountActive,
                                  ]}
                                >
                                  {count}
                                </Text>
                              </Pressable>
                              {active ? (
                                <>
                                  <Pressable
                                    style={({ pressed }) => [
                                      styles.chipIcon,
                                      pressed && styles.pressedSoft,
                                    ]}
                                    onPress={() =>
                                      startRenameSection(sec.id, sec.label)
                                    }
                                    hitSlop={6}
                                    accessibilityLabel={`Renomear ${sec.label}`}
                                  >
                                    <Feather
                                      name="edit-2"
                                      size={ms(13)}
                                      color={colors.brownSoft}
                                    />
                                  </Pressable>
                                  <Pressable
                                    style={({ pressed }) => [
                                      styles.chipIconDanger,
                                      pressed && styles.pressedSoft,
                                    ]}
                                    onPress={() => handleRemoveSection(sec.id)}
                                    hitSlop={6}
                                    accessibilityLabel={`Remover ${sec.label}`}
                                  >
                                    <Feather
                                      name="trash-2"
                                      size={ms(13)}
                                      color={colors.danger}
                                    />
                                  </Pressable>
                                </>
                              ) : null}
                            </>
                          )}
                        </View>
                      );
                    })
                  )}
                </ScrollView>

                {/* Nova seção (linha compacta abaixo da faixa). */}
                <View style={styles.stripNewRow}>
                  <TextInput
                    value={draftSection}
                    onChangeText={setDraftSection}
                    onSubmitEditing={handleAddSection}
                    returnKeyType="done"
                    placeholder="Nova seção"
                    placeholderTextColor={colors.textFaint}
                    maxLength={22}
                    style={styles.stripNewInput}
                    selectionColor={colors.gold}
                  />
                  <Pressable
                    style={({ pressed }) => [
                      styles.stripNewBtn,
                      pressed && styles.pressedSoft,
                    ]}
                    onPress={handleAddSection}
                    accessibilityLabel="Adicionar seção"
                  >
                    <Feather name="plus" size={ms(18)} color={colors.creamCard} />
                  </Pressable>
                </View>
              </View>
            ) : (
              /* ---- PAISAGEM: coluna de seções (duas colunas) ---- */
              <View style={styles.sectionsCol}>
              {/* Botão "Todos os produtos" (visão agregada). */}
              <Pressable
                style={({ pressed }) => [
                  styles.allBtn,
                  isAll && styles.allBtnActive,
                  pressed && styles.pressedSoft,
                ]}
                onPress={() => {
                  setManageCat('ALL');
                  setForm(null);
                  setSectionEditId(null);
                  setSearch('');
                }}
              >
                <View
                  style={[styles.allBtnIcon, isAll && styles.allBtnIconActive]}
                >
                  <Feather
                    name="menu"
                    size={ms(17)}
                    color={isAll ? colors.creamCard : colors.goldDeepAlt}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={[styles.allBtnTitle, isAll && styles.allBtnTitleActive]}
                    numberOfLines={1}
                  >
                    Todos os produtos
                  </Text>
                  <Text
                    style={[styles.allBtnCount, isAll && styles.allBtnCountActive]}
                  >
                    {products.length}{' '}
                    {products.length === 1 ? 'produto' : 'produtos'}
                  </Text>
                </View>
              </Pressable>

              <Text style={styles.colTitle}>Seções</Text>
              <ScrollView
                style={styles.sectionsList}
                contentContainerStyle={styles.sectionsListContent}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {sortedSections.length === 0 ? (
                  <Text style={styles.sectionsEmpty}>Nenhuma seção ainda</Text>
                ) : (
                  sortedSections.map((s) => {
                    const active = s.id === manageCat;
                    const editing = s.id === sectionEditId;
                    return (
                      <View
                        key={s.id}
                        style={[
                          styles.sectionRow,
                          active && styles.sectionRowActive,
                        ]}
                      >
                        {editing ? (
                          <TextInput
                            ref={secInputRef}
                            value={sectionEditLabel}
                            onChangeText={setSectionEditLabel}
                            onSubmitEditing={commitRenameSection}
                            onBlur={commitRenameSection}
                            returnKeyType="done"
                            maxLength={22}
                            style={styles.sectionEditInput}
                            selectionColor={colors.gold}
                          />
                        ) : (
                          <>
                            <Pressable
                              style={styles.sectionInfo}
                              onPress={() => handleSelectSection(s.id)}
                            >
                              <Text
                                style={[
                                  styles.sectionLabel,
                                  active && styles.sectionLabelActive,
                                ]}
                                numberOfLines={1}
                              >
                                {s.label}
                              </Text>
                              <Text style={styles.sectionCount}>
                                {(countBySection[s.id] ?? 0)}{' '}
                                {(countBySection[s.id] ?? 0) === 1
                                  ? 'produto'
                                  : 'produtos'}
                              </Text>
                            </Pressable>
                            <Pressable
                              style={({ pressed }) => [
                                styles.iconBtn,
                                pressed && styles.pressedSoft,
                              ]}
                              onPress={() => startRenameSection(s.id, s.label)}
                              hitSlop={6}
                              accessibilityLabel={`Renomear ${s.label}`}
                            >
                              <Feather
                                name="edit-2"
                                size={ms(14)}
                                color={colors.brownSoft}
                              />
                            </Pressable>
                            <Pressable
                              style={({ pressed }) => [
                                styles.iconBtnDanger,
                                pressed && styles.pressedSoft,
                              ]}
                              onPress={() => handleRemoveSection(s.id)}
                              hitSlop={6}
                              accessibilityLabel={`Remover ${s.label}`}
                            >
                              <Feather
                                name="trash-2"
                                size={ms(14)}
                                color={colors.danger}
                              />
                            </Pressable>
                          </>
                        )}
                      </View>
                    );
                  })
                )}
              </ScrollView>

              {/* Nova seção */}
              <View style={styles.newSectionRow}>
                <TextInput
                  value={draftSection}
                  onChangeText={setDraftSection}
                  onSubmitEditing={handleAddSection}
                  returnKeyType="done"
                  placeholder="Nova seção"
                  placeholderTextColor={colors.textFaint}
                  maxLength={22}
                  style={styles.newSectionInput}
                  selectionColor={colors.gold}
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.newSectionBtn,
                    pressed && styles.pressedSoft,
                  ]}
                  onPress={handleAddSection}
                  accessibilityLabel="Adicionar seção"
                >
                  <Feather name="plus" size={ms(18)} color={colors.creamCard} />
                </Pressable>
              </View>
              </View>
            )}

            {/* Coluna de produtos */}
            <View style={styles.productsCol}>
              {!hasAnySection || (!isAll && currentSection === null) ? (
                // Estado vazio: nenhuma seção.
                <View style={styles.noSectionWrap}>
                  <View style={styles.noSectionIcon}>
                    <Feather
                      name="folder"
                      size={ms(30)}
                      color={colors.goldDeepAlt}
                    />
                  </View>
                  <Text style={styles.noSectionTitle}>Nenhuma seção ainda</Text>
                  <Text style={styles.noSectionText}>
                    Crie uma seção {stacked ? 'acima' : 'ao lado'} (ex.: Chopp,
                    Porções) para começar a cadastrar produtos.
                  </Text>
                </View>
              ) : (
                <>
                  {/* Header da seção */}
                  <View style={styles.productsHeader}>
                    <View style={styles.productsHeaderTop}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.productsTitle} numberOfLines={1}>
                          {isAll ? 'Todos os produtos' : currentSection?.label}
                        </Text>
                        <Text style={styles.productsSubtitle}>
                          {sectionProducts.length}{' '}
                          {sectionProducts.length === 1 ? 'produto' : 'produtos'}
                        </Text>
                      </View>
                      <Pressable
                        style={({ pressed }) => [
                          styles.newProductBtn,
                          pressed && styles.pressedSoft,
                        ]}
                        onPress={startNewProduct}
                      >
                        <Feather
                          name="plus"
                          size={ms(16)}
                          color={colors.creamCard}
                        />
                        <Text style={styles.newProductText}>Novo produto</Text>
                      </Pressable>
                    </View>
                    <View style={styles.searchWrap}>
                      <Feather
                        name="search"
                        size={ms(15)}
                        color={colors.textFaint}
                        style={styles.searchIcon}
                      />
                      <TextInput
                        value={search}
                        onChangeText={setSearch}
                        placeholder="Buscar produto"
                        placeholderTextColor={colors.textFaint}
                        style={styles.searchInput}
                        selectionColor={colors.gold}
                      />
                    </View>
                  </View>

                  {/* Lista de produtos + formulário */}
                  <ScrollView
                    style={styles.productsList}
                    contentContainerStyle={styles.productsListContent}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                  >
                    {/* Formulário de novo produto (topo). */}
                    {form && form.id === null ? (
                      <ProductFormCard
                        title="Cadastrar produto"
                        confirmLabel="Salvar produto"
                        form={form}
                        sections={sortedSections}
                        nameRef={productNameRef}
                        uploading={uploading}
                        styles={styles}
                        s={s}
                        ms={ms}
                        onChange={setForm}
                        onCancel={cancelForm}
                        onSave={saveForm}
                        onChoosePhoto={choosePhoto}
                        onClearPhoto={clearPhoto}
                      />
                    ) : null}

                    {visibleProducts.length === 0 ? (
                      term.length > 0 ? (
                        <View style={styles.listEmpty}>
                          <View style={styles.listEmptyIcon}>
                            <Feather
                              name="search"
                              size={ms(26)}
                              color={colors.goldDeepAlt}
                            />
                          </View>
                          <Text style={styles.listEmptyTitle}>
                            Nada encontrado
                          </Text>
                          <Text style={styles.listEmptyText}>
                            Nenhum produto para a busca "{search.trim()}".
                          </Text>
                        </View>
                      ) : form && form.id === null ? null : (
                        <View style={styles.listEmpty}>
                          <View style={styles.listEmptyIcon}>
                            <Feather
                              name="package"
                              size={ms(26)}
                              color={colors.goldDeepAlt}
                            />
                          </View>
                          <Text style={styles.listEmptyTitle}>
                            {isAll
                              ? 'Nenhum produto cadastrado'
                              : 'Nenhum produto nesta seção'}
                          </Text>
                          <Text style={styles.listEmptyText}>
                            Toque em "Novo produto" para cadastrar.
                          </Text>
                        </View>
                      )
                    ) : (
                      visibleProducts.map((p) =>
                        editingProductId === p.id ? (
                          <ProductFormCard
                            key={p.id}
                            title="Editar produto"
                            confirmLabel="Salvar"
                            form={form as ProductForm}
                            sections={sortedSections}
                            nameRef={productNameRef}
                            uploading={uploading}
                            styles={styles}
                            s={s}
                            ms={ms}
                            onChange={setForm}
                            onCancel={cancelForm}
                            onSave={saveForm}
                            onChoosePhoto={choosePhoto}
                            onClearPhoto={clearPhoto}
                          />
                        ) : (
                          <View key={p.id} style={styles.productRow}>
                            {p.imageUrl ? (
                              <Image
                                source={{ uri: p.imageUrl }}
                                style={[
                                  styles.productBadge,
                                  !p.available && styles.productBadgeMuted,
                                ]}
                              />
                            ) : (
                              <View
                                style={[
                                  styles.productBadge,
                                  !p.available && styles.productBadgeMuted,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.productBadgeText,
                                    !p.available && styles.productBadgeTextMuted,
                                  ]}
                                >
                                  {initialOf(p.name, p.icon)}
                                </Text>
                              </View>
                            )}
                            <View style={styles.productMain}>
                              <Text style={styles.productName} numberOfLines={1}>
                                {p.name}
                              </Text>
                              <View style={styles.productMeta}>
                                {isAll ? (
                                  <View style={styles.sectionTag}>
                                    <Text
                                      style={styles.sectionTagText}
                                      numberOfLines={1}
                                    >
                                      {sectionLabelById[p.sectionId] ?? '—'}
                                    </Text>
                                  </View>
                                ) : null}
                                <Pressable
                                  style={({ pressed }) => [
                                    styles.availToggle,
                                    p.available ? styles.availOn : styles.availOff,
                                    pressed && styles.pressedSoft,
                                  ]}
                                  onPress={() => toggleAvailable(p.id)}
                                  hitSlop={4}
                                  accessibilityLabel="Alternar disponibilidade"
                                >
                                  <Text
                                    style={[
                                      styles.availText,
                                      p.available
                                        ? styles.availTextOn
                                        : styles.availTextOff,
                                    ]}
                                  >
                                    {p.available ? 'Disponível' : 'Esgotado'}
                                  </Text>
                                </Pressable>
                              </View>
                            </View>
                            <Text style={styles.productPrice}>
                              {money(p.price)}
                            </Text>
                            <Pressable
                              style={({ pressed }) => [
                                styles.iconBtn,
                                pressed && styles.pressedSoft,
                              ]}
                              onPress={() => startEditProduct(p)}
                              hitSlop={6}
                              accessibilityLabel={`Editar ${p.name}`}
                            >
                              <Feather
                                name="edit-2"
                                size={ms(14)}
                                color={colors.brownSoft}
                              />
                            </Pressable>
                            <Pressable
                              style={({ pressed }) => [
                                styles.iconBtnDanger,
                                pressed && styles.pressedSoft,
                              ]}
                              onPress={() => removeProduct(p.id)}
                              hitSlop={6}
                              accessibilityLabel={`Remover ${p.name}`}
                            >
                              <Feather
                                name="trash-2"
                                size={ms(14)}
                                color={colors.danger}
                              />
                            </Pressable>
                          </View>
                        ),
                      )
                    )}
                  </ScrollView>
                </>
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Cartão de formulário de produto (cadastro / edição).
// ---------------------------------------------------------------------------

interface ProductFormCardProps {
  title: string;
  confirmLabel: string;
  form: ProductForm;
  sections: { id: string; label: string }[];
  nameRef: React.RefObject<TextInput | null>;
  uploading: boolean;
  styles: Styles;
  s: (n: number) => number;
  ms: (n: number) => number;
  onChange: (next: ProductForm) => void;
  onCancel: () => void;
  onSave: () => void;
  onChoosePhoto: () => void;
  onClearPhoto: () => void;
}

function ProductFormCard({
  title,
  confirmLabel,
  form,
  sections,
  nameRef,
  uploading,
  styles,
  s,
  ms,
  onChange,
  onCancel,
  onSave,
  onChoosePhoto,
  onClearPhoto,
}: ProductFormCardProps) {
  // Preview: prioriza a foto local recém-escolhida; senão a URL já salva.
  const previewUri = form.localImageUri || form.imageUrl;
  const hasPhoto = previewUri.length > 0;

  // Layout responsivo do topo do formulário (Nome / Preço / Disponibilidade).
  // Mede a LARGURA REAL disponível para a linha (onLayout) em vez de confiar só
  // na largura da JANELA: em paisagem (2 colunas) o formulário vive na COLUNA
  // DE PRODUTOS, bem mais estreita que a janela — era por isso que o Nome e o
  // Preço ficavam espremidos/cortados. Decidindo pela largura própria da linha,
  // o campo Nome NUNCA disputa espaço com o Preço e nunca fica cortado.
  const [rowW, setRowW] = useState(0);
  const gap = s(8);
  const priceMin = s(130); // largura do campo de preço quando lado a lado
  const availMin = s(120); // largura mínima do botão Disponível/Esgotado
  const nameMin = s(160); // largura mínima confortável do Nome quando inline
  const secondRowMin = priceMin + gap + availMin; // Preço + botão lado a lado
  const inlineAllMin = nameMin + gap + secondRowMin; // os três na mesma linha
  // rowW === 0 no primeiro render (antes do onLayout): assumimos o layout
  // SEGURO (Nome em linha inteira) para nunca "piscar" cortado.
  const canInlineAll = rowW >= inlineAllMin;
  const canInlineSecond = rowW === 0 || rowW >= secondRowMin;

  return (
    <View style={styles.formCard}>
      <View style={styles.formTitleRow}>
        <View style={styles.formTitleDot} />
        <Text style={styles.formTitle}>{title}</Text>
      </View>

      {/* Foto do produto */}
      <View style={styles.photoRow}>
        <Pressable
          style={({ pressed }) => [
            styles.photoBox,
            pressed && styles.pressedSoft,
          ]}
          onPress={onChoosePhoto}
        >
          {hasPhoto ? (
            <Image source={{ uri: previewUri }} style={styles.photoImg} />
          ) : (
            <Feather name="camera" size={ms(24)} color={colors.goldDeepAlt} />
          )}
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.photoLabel}>Foto do produto</Text>
          <Text style={styles.photoHint}>
            {hasPhoto
              ? 'Toque na imagem para trocar.'
              : 'Câmera ou galeria. Opcional.'}
          </Text>
          <View style={styles.photoBtns}>
            <Pressable
              style={({ pressed }) => [
                styles.photoBtn,
                pressed && styles.pressedSoft,
              ]}
              onPress={onChoosePhoto}
            >
              <Feather name="image" size={ms(13)} color={colors.goldDeep} />
              <Text style={styles.photoBtnText}>
                {hasPhoto ? 'Trocar' : 'Adicionar'}
              </Text>
            </Pressable>
            {hasPhoto ? (
              <Pressable
                style={({ pressed }) => [
                  styles.photoBtnDanger,
                  pressed && styles.pressedSoft,
                ]}
                onPress={onClearPhoto}
              >
                <Feather name="trash-2" size={ms(13)} color={colors.danger} />
                <Text style={styles.photoBtnDangerText}>Remover</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      <View
        style={[
          styles.formTopRow,
          { flexDirection: canInlineAll ? 'row' : 'column' },
        ]}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          // Só atualiza em mudança real de largura (rotação/redimensionamento);
          // digitar NÃO muda a largura, então não re-renderiza por isso e o
          // TextInput focado não perde o foco.
          setRowW((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
        }}
      >
        <TextInput
          ref={nameRef}
          value={form.name}
          onChangeText={(name) => onChange({ ...form, name })}
          placeholder="Nome do produto"
          placeholderTextColor={colors.textFaint}
          maxLength={34}
          style={[
            styles.formNameInput,
            canInlineAll ? styles.formNameInputInline : styles.formNameInputFull,
          ]}
          selectionColor={colors.gold}
        />
        <View
          style={[
            styles.formTopRowSecond,
            !canInlineAll && styles.formTopRowSecondFull,
            { flexDirection: canInlineSecond ? 'row' : 'column' },
          ]}
        >
          <View
            style={[styles.priceWrap, !canInlineSecond && styles.priceWrapFull]}
          >
            <Text style={styles.pricePrefix}>R$</Text>
            <TextInput
              value={form.price}
              onChangeText={(price) =>
                onChange({ ...form, price: maskPrice(price) })
              }
              placeholder="0,00"
              placeholderTextColor={colors.textFaint}
              keyboardType="decimal-pad"
              style={styles.priceInput}
              selectionColor={colors.gold}
            />
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.formAvailBtn,
              canInlineSecond
                ? styles.formAvailBtnInline
                : styles.formAvailBtnFull,
              form.available ? styles.formAvailOn : styles.formAvailOff,
              pressed && styles.pressedSoft,
            ]}
            onPress={() => onChange({ ...form, available: !form.available })}
          >
            <Text
              style={[
                styles.formAvailText,
                form.available
                  ? styles.formAvailTextOn
                  : styles.formAvailTextOff,
              ]}
            >
              {form.available ? 'Disponível' : 'Esgotado'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.bindWrap}>
        <Text style={styles.bindLabel}>Amarrar à seção</Text>
        <View style={styles.bindOptions}>
          {sections.map((s) => {
            const active = s.id === form.sectionId;
            return (
              <Pressable
                key={s.id}
                style={({ pressed }) => [
                  styles.bindChip,
                  active && styles.bindChipActive,
                  pressed && styles.pressedSoft,
                ]}
                onPress={() => onChange({ ...form, sectionId: s.id })}
              >
                <Text
                  style={[
                    styles.bindChipText,
                    active && styles.bindChipTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.formActions}>
        <Pressable
          style={({ pressed }) => [
            styles.formCancelBtn,
            pressed && styles.pressedSoft,
          ]}
          onPress={onCancel}
          disabled={uploading}
        >
          <Text style={styles.formCancelText}>Cancelar</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.formSaveBtn,
            uploading && styles.formSaveBtnBusy,
            pressed && !uploading && styles.pressedSoft,
          ]}
          onPress={onSave}
          disabled={uploading}
        >
          {uploading ? (
            <View style={styles.savingRow}>
              <ActivityIndicator size="small" color={colors.creamCard} />
              <Text style={styles.formSaveText}>Enviando foto…</Text>
            </View>
          ) : (
            <Text style={styles.formSaveText}>{confirmLabel}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos (dinâmicos — criados via useMemo com o fator de escala atual).
// ---------------------------------------------------------------------------

function createStyles(
  s: (n: number) => number,
  ms: (n: number) => number,
  width: number,
  stacked: boolean,
) {
  // Largura do card: em RETRATO usa quase toda a largura (menos a margem do
  // overlay); em PAISAGEM segue o mockup (1040) sem estourar a tela.
  const cardWidth = stacked
    ? width - s(40)
    : Math.min(s(1040), width - s(48));
  // Sombra padrão dos cards (sutil e consistente).
  const cardShadow = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: s(4) },
    shadowOpacity: 0.1,
    shadowRadius: s(10),
    elevation: 3,
  } as const;

  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(30,15,7,0.64)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: s(20),
    },
    card: {
      width: cardWidth,
      maxWidth: '100%',
      height: s(660),
      maxHeight: '94%',
      backgroundColor: colors.creamCard,
      borderRadius: s(22),
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.borderCream,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: s(24) },
      shadowOpacity: 0.4,
      shadowRadius: s(48),
      elevation: 30,
    },

    // Pressed feedback compartilhado.
    pressedSoft: {
      opacity: 0.72,
    },

    // ---- Header ----
    header: {
      paddingVertical: s(16),
      paddingHorizontal: s(22),
      backgroundColor: colors.woodHeader,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: s(12),
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(12),
      flex: 1,
      minWidth: 0,
    },
    headerIcon: {
      width: s(42),
      height: s(42),
      borderRadius: s(12),
      backgroundColor: 'rgba(200,127,20,0.13)',
      borderWidth: 1,
      borderColor: 'rgba(200,127,20,0.33)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerKicker: {
      fontFamily: fonts.heading,
      fontSize: ms(10),
      letterSpacing: 2.4,
      textTransform: 'uppercase',
      color: colors.amberSoft,
    },
    headerTitle: {
      fontFamily: fonts.heading,
      fontSize: ms(22),
      color: colors.creamText,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(14),
    },
    savedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(7),
      paddingVertical: s(6),
      paddingHorizontal: s(11),
      borderRadius: s(20),
      backgroundColor: 'rgba(143,203,147,0.14)',
      borderWidth: 1,
      borderColor: 'rgba(143,203,147,0.4)',
    },
    savedText: {
      color: colors.successBorder,
      fontFamily: fonts.heading,
      fontSize: ms(10),
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    closeBtn: {
      width: s(42),
      height: s(42),
      borderRadius: s(12),
      backgroundColor: 'rgba(255,255,255,0.08)',
      alignItems: 'center',
      justifyContent: 'center',
    },

    // ---- Corpo ----
    bodyRow: {
      flex: 1,
      flexDirection: stacked ? 'column' : 'row',
      minHeight: 0,
    },

    // ---- Coluna de seções (somente PAISAGEM; retrato usa a faixa de chips) --
    sectionsCol: {
      width: s(300),
      borderRightWidth: 1,
      borderRightColor: '#EAD9B6',
      paddingVertical: s(16),
      paddingHorizontal: s(16),
      backgroundColor: colors.creamPanel,
    },

    // ---- Faixa de seções (somente RETRATO): chips roláveis + "Nova seção" --
    sectionsStrip: {
      backgroundColor: colors.creamPanel,
      borderBottomWidth: 1,
      borderBottomColor: '#EAD9B6',
      paddingTop: s(12),
      paddingBottom: s(12),
      gap: s(10),
    },
    stripContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(8),
      paddingHorizontal: s(14),
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(7),
      height: s(48),
      paddingHorizontal: s(14),
      borderRadius: s(14),
      borderWidth: 1,
      borderColor: colors.borderCream,
      backgroundColor: colors.creamCard,
      ...cardShadow,
    },
    chipActive: {
      backgroundColor: colors.gold,
      borderColor: colors.goldDeep,
      shadowColor: colors.gold,
      shadowOpacity: 0.3,
    },
    chipSelect: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(7),
      maxWidth: s(220),
    },
    chipLabel: {
      fontFamily: fonts.headingMedium,
      fontSize: ms(14),
      color: colors.textHeading,
    },
    chipLabelActive: {
      color: colors.creamCard,
    },
    chipCount: {
      fontFamily: fonts.body,
      fontSize: ms(11),
      color: colors.goldDeepAlt,
      minWidth: s(14),
      textAlign: 'center',
    },
    chipCountActive: {
      color: colors.creamCard,
      opacity: 0.85,
    },
    chipIcon: {
      width: s(32),
      height: s(32),
      borderRadius: s(9),
      borderWidth: 1,
      borderColor: colors.borderCream,
      backgroundColor: colors.creamCard,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipIconDanger: {
      width: s(32),
      height: s(32),
      borderRadius: s(9),
      borderWidth: 1,
      borderColor: colors.dangerBorder,
      backgroundColor: colors.dangerBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipEditInput: {
      minWidth: s(150),
      paddingVertical: s(6),
      paddingHorizontal: s(10),
      borderRadius: s(9),
      borderWidth: 1,
      borderColor: colors.gold,
      backgroundColor: colors.white,
      color: colors.textHeading,
      fontFamily: fonts.headingMedium,
      fontSize: ms(14),
    },
    stripEmpty: {
      color: colors.textFaint,
      fontFamily: fonts.body,
      fontSize: ms(13),
      paddingVertical: s(12),
      paddingHorizontal: s(6),
    },
    stripNewRow: {
      flexDirection: 'row',
      gap: s(8),
      paddingHorizontal: s(14),
    },
    stripNewInput: {
      flex: 1,
      minHeight: s(44),
      paddingVertical: s(10),
      paddingHorizontal: s(12),
      borderRadius: s(10),
      borderWidth: 1,
      borderColor: colors.borderCreamSoft,
      backgroundColor: colors.white,
      color: colors.textHeading,
      fontFamily: fonts.body,
      fontSize: ms(14),
    },
    stripNewBtn: {
      width: s(46),
      minHeight: s(44),
      borderRadius: s(10),
      backgroundColor: colors.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },
    colTitle: {
      fontFamily: fonts.heading,
      fontSize: ms(12),
      letterSpacing: 1.6,
      textTransform: 'uppercase',
      color: colors.goldDeepAlt,
      marginTop: s(14),
      marginBottom: s(10),
    },

    // ---- Botão "Todos os produtos" ----
    allBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(11),
      paddingVertical: s(11),
      paddingHorizontal: s(12),
      borderRadius: s(14),
      borderWidth: 1,
      borderColor: colors.borderCream,
      backgroundColor: colors.cream,
      ...cardShadow,
    },
    allBtnActive: {
      backgroundColor: colors.gold,
      borderColor: colors.goldDeep,
      shadowColor: colors.gold,
      shadowOpacity: 0.35,
    },
    allBtnIcon: {
      width: s(36),
      height: s(36),
      borderRadius: s(10),
      backgroundColor: 'rgba(255,255,255,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    allBtnIconActive: {
      backgroundColor: 'rgba(255,255,255,0.2)',
    },
    allBtnTitle: {
      fontFamily: fonts.heading,
      fontSize: ms(15),
      color: colors.textHeading,
    },
    allBtnTitleActive: {
      color: colors.creamCard,
    },
    allBtnCount: {
      fontSize: ms(11),
      marginTop: 1,
      fontFamily: fonts.body,
      color: colors.goldDeepAlt,
    },
    allBtnCountActive: {
      color: colors.creamCard,
      opacity: 0.85,
    },

    sectionTag: {
      maxWidth: s(140),
      paddingVertical: s(4),
      paddingHorizontal: s(10),
      borderRadius: s(20),
      backgroundColor: '#EFE1C4',
    },
    sectionTagText: {
      fontFamily: fonts.heading,
      fontSize: ms(10),
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.brownSoft,
    },

    sectionsList: {
      flex: 1,
    },
    sectionsListContent: {
      paddingBottom: s(4),
    },
    sectionsEmpty: {
      color: colors.textFaint,
      fontSize: ms(13),
      fontFamily: fonts.body,
      paddingVertical: s(18),
      paddingHorizontal: s(8),
      textAlign: 'center',
    },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(6),
      paddingVertical: s(9),
      paddingHorizontal: s(10),
      borderRadius: s(12),
      marginBottom: s(6),
      backgroundColor: colors.creamCard,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    sectionRowActive: {
      backgroundColor: colors.creamCard,
      borderColor: colors.borderCream,
      ...cardShadow,
    },
    sectionInfo: {
      flex: 1,
      minWidth: 0,
    },
    sectionLabel: {
      fontFamily: fonts.headingMedium,
      fontSize: ms(15),
      color: colors.textHeading,
    },
    sectionLabelActive: {
      color: colors.goldDeep,
    },
    sectionCount: {
      fontSize: ms(11),
      color: colors.goldDeepAlt,
      marginTop: 1,
      fontFamily: fonts.body,
    },
    sectionEditInput: {
      flex: 1,
      paddingVertical: s(8),
      paddingHorizontal: s(10),
      borderRadius: s(9),
      borderWidth: 1,
      borderColor: colors.gold,
      backgroundColor: colors.white,
      color: colors.textHeading,
      fontFamily: fonts.headingMedium,
      fontSize: ms(15),
    },

    iconBtn: {
      width: s(34),
      height: s(34),
      borderRadius: s(9),
      borderWidth: 1,
      borderColor: colors.borderCream,
      backgroundColor: colors.creamCard,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconBtnDanger: {
      width: s(34),
      height: s(34),
      borderRadius: s(9),
      borderWidth: 1,
      borderColor: colors.dangerBorder,
      backgroundColor: colors.dangerBg,
      alignItems: 'center',
      justifyContent: 'center',
    },

    newSectionRow: {
      flexDirection: 'row',
      gap: s(8),
      paddingTop: s(14),
      borderTopWidth: 1,
      borderTopColor: '#E4D6B8',
      marginTop: s(10),
    },
    newSectionInput: {
      flex: 1,
      paddingVertical: s(11),
      paddingHorizontal: s(12),
      borderRadius: s(10),
      borderWidth: 1,
      borderColor: colors.borderCreamSoft,
      backgroundColor: colors.white,
      color: colors.textHeading,
      fontFamily: fonts.body,
      fontSize: ms(14),
      minHeight: s(44),
    },
    newSectionBtn: {
      width: s(46),
      minHeight: s(44),
      borderRadius: s(10),
      backgroundColor: colors.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // ---- Coluna de produtos ----
    // minHeight:0 é essencial no modo empilhado: permite que este item flex
    // encolha para caber e que o ScrollView interno (flex:1) role de fato.
    productsCol: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
    },
    productsHeader: {
      gap: s(12),
      paddingVertical: s(16),
      paddingHorizontal: s(20),
      borderBottomWidth: 1,
      borderBottomColor: '#EAD9B6',
    },
    productsHeaderTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(10),
    },
    productsTitle: {
      fontFamily: fonts.heading,
      fontSize: ms(20),
      color: colors.textHeading,
    },
    productsSubtitle: {
      fontSize: ms(12),
      color: colors.goldDeepAlt,
      marginTop: 1,
      fontFamily: fonts.body,
    },
    searchWrap: {
      position: 'relative',
      justifyContent: 'center',
    },
    searchIcon: {
      position: 'absolute',
      left: s(12),
      zIndex: 1,
    },
    searchInput: {
      width: '100%',
      minHeight: s(44),
      paddingVertical: s(10),
      paddingLeft: s(34),
      paddingRight: s(12),
      borderRadius: s(10),
      borderWidth: 1,
      borderColor: colors.borderCreamSoft,
      backgroundColor: colors.white,
      color: colors.textHeading,
      fontFamily: fonts.body,
      fontSize: ms(14),
    },
    newProductBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(7),
      paddingVertical: s(11),
      paddingHorizontal: s(16),
      minHeight: s(44),
      borderRadius: s(11),
      backgroundColor: colors.gold,
      shadowColor: colors.gold,
      shadowOffset: { width: 0, height: s(6) },
      shadowOpacity: 0.38,
      shadowRadius: s(14),
      elevation: 6,
    },
    newProductText: {
      fontFamily: fonts.heading,
      fontSize: ms(13),
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.creamCard,
    },
    productsList: {
      flex: 1,
    },
    productsListContent: {
      paddingHorizontal: s(20),
      paddingTop: s(16),
      paddingBottom: s(24),
    },

    // ---- Linha de produto ----
    productRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(11),
      paddingVertical: s(10),
      paddingHorizontal: s(12),
      marginBottom: s(9),
      borderRadius: s(14),
      borderWidth: 1,
      borderColor: colors.borderCream,
      backgroundColor: colors.white,
      ...cardShadow,
    },
    productBadge: {
      width: s(42),
      height: s(42),
      borderRadius: s(11),
      backgroundColor: '#F0E2C6',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    productBadgeMuted: {
      backgroundColor: colors.creamAlt,
      opacity: 0.7,
    },
    productBadgeText: {
      fontFamily: fonts.heading,
      fontSize: ms(18),
      color: colors.goldDeepAlt,
    },
    productBadgeTextMuted: {
      color: colors.textFaint,
    },
    productMain: {
      flex: 1,
      minWidth: 0,
      gap: s(4),
    },
    productName: {
      fontSize: ms(15),
      fontFamily: fonts.bodyBold,
      color: colors.textHeading,
    },
    productMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(7),
      flexWrap: 'wrap',
    },
    availToggle: {
      paddingVertical: s(5),
      paddingHorizontal: s(11),
      borderRadius: s(20),
      borderWidth: 1,
    },
    availOn: {
      backgroundColor: colors.successBg,
      borderColor: colors.successBorder,
    },
    availOff: {
      backgroundColor: colors.dangerBg,
      borderColor: colors.dangerBorder,
    },
    availText: {
      fontFamily: fonts.heading,
      fontSize: ms(10),
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    availTextOn: {
      color: colors.success,
    },
    availTextOff: {
      color: colors.danger,
    },
    productPrice: {
      fontFamily: fonts.heading,
      fontSize: ms(16),
      color: colors.goldDeepAlt,
      minWidth: s(78),
      textAlign: 'right',
    },

    // ---- Estados vazios de produtos ----
    listEmpty: {
      paddingVertical: s(48),
      paddingHorizontal: s(20),
      alignItems: 'center',
      gap: s(6),
    },
    listEmptyIcon: {
      width: s(56),
      height: s(56),
      borderRadius: s(16),
      backgroundColor: '#EFE1C4',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: s(6),
    },
    listEmptyTitle: {
      fontFamily: fonts.heading,
      fontSize: ms(16),
      color: colors.textMuted,
    },
    listEmptyText: {
      fontSize: ms(13),
      color: colors.textFaint,
      fontFamily: fonts.body,
      textAlign: 'center',
    },

    // ---- Estado vazio: sem seção ----
    noSectionWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(10),
      padding: s(30),
    },
    noSectionIcon: {
      width: s(64),
      height: s(64),
      borderRadius: s(18),
      backgroundColor: '#EFE1C4',
      alignItems: 'center',
      justifyContent: 'center',
    },
    noSectionTitle: {
      fontFamily: fonts.heading,
      fontSize: ms(18),
      color: colors.textMuted,
    },
    noSectionText: {
      fontSize: ms(13),
      color: colors.textFaint,
      textAlign: 'center',
      maxWidth: s(280),
      fontFamily: fonts.body,
      lineHeight: ms(19),
    },

    // ---- Formulário de produto ----
    formCard: {
      padding: s(16),
      marginBottom: s(12),
      backgroundColor: '#FFF8E9',
      borderWidth: 1.5,
      borderColor: '#E7C77E',
      borderRadius: s(16),
      shadowColor: colors.gold,
      shadowOffset: { width: 0, height: s(6) },
      shadowOpacity: 0.16,
      shadowRadius: s(16),
      elevation: 4,
    },
    formTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(8),
      marginBottom: s(12),
    },
    formTitleDot: {
      width: s(8),
      height: s(8),
      borderRadius: s(4),
      backgroundColor: colors.gold,
    },
    formTitle: {
      fontFamily: fonts.heading,
      fontSize: ms(11),
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: colors.goldDeepAlt,
    },
    formTopRow: {
      flexDirection: stacked ? 'column' : 'row',
      gap: s(8),
      alignItems: 'stretch',
    },
    formTopRowSecond: {
      flexDirection: 'row',
      gap: s(8),
      alignItems: 'stretch',
    },
    // Quando o segundo bloco (Preço + Disponível) desce para baixo do Nome,
    // ocupa toda a largura disponível da coluna.
    formTopRowSecondFull: {
      alignSelf: 'stretch',
      width: '100%',
    },
    formNameInput: {
      minWidth: 0,
      height: s(46),
      paddingHorizontal: s(14),
      borderRadius: s(10),
      borderWidth: 1,
      borderColor: colors.borderCreamSoft,
      backgroundColor: colors.white,
      color: colors.textHeading,
      fontFamily: fonts.body,
      fontSize: ms(14),
    },
    // Nome inline (divide a linha com Preço/Disponível): cresce no espaço livre.
    formNameInputInline: {
      flex: 1,
    },
    // Nome em linha inteira (layout empilhado): ocupa toda a largura da coluna.
    formNameInputFull: {
      alignSelf: 'stretch',
      width: '100%',
    },
    priceWrap: {
      position: 'relative',
      width: s(130),
      justifyContent: 'center',
    },
    // Quando Preço e botão empilham (linha muito estreita): Preço ocupa a linha.
    priceWrapFull: {
      width: '100%',
    },
    pricePrefix: {
      position: 'absolute',
      left: s(12),
      zIndex: 1,
      color: colors.goldDeepAlt,
      fontFamily: fonts.headingRegular,
      fontSize: ms(14),
    },
    priceInput: {
      width: '100%',
      height: s(46),
      paddingLeft: s(38),
      paddingRight: s(10),
      borderRadius: s(10),
      borderWidth: 1,
      borderColor: colors.borderCreamSoft,
      backgroundColor: colors.white,
      color: colors.textHeading,
      fontFamily: fonts.headingRegular,
      fontSize: ms(15),
    },
    formAvailBtn: {
      minWidth: s(120),
      height: s(46),
      paddingHorizontal: s(14),
      borderRadius: s(10),
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Botão Disponível/Esgotado lado a lado com o Preço: preenche o resto.
    formAvailBtnInline: {
      flex: 1,
    },
    // Botão empilhado abaixo do Preço (linha estreita): largura inteira.
    formAvailBtnFull: {
      alignSelf: 'stretch',
      width: '100%',
    },
    formAvailOn: {
      backgroundColor: colors.successBg,
      borderColor: colors.successBorder,
    },
    formAvailOff: {
      backgroundColor: colors.dangerBg,
      borderColor: colors.dangerBorder,
    },
    formAvailText: {
      fontFamily: fonts.heading,
      fontSize: ms(11),
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    formAvailTextOn: {
      color: colors.success,
    },
    formAvailTextOff: {
      color: colors.danger,
    },
    bindWrap: {
      marginTop: s(12),
    },
    bindLabel: {
      fontFamily: fonts.heading,
      fontSize: ms(10),
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.goldDeepAlt,
      marginBottom: s(7),
    },
    bindOptions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: s(6),
    },
    bindChip: {
      paddingVertical: s(9),
      paddingHorizontal: s(13),
      minHeight: s(40),
      justifyContent: 'center',
      borderRadius: s(10),
      borderWidth: 1,
      borderColor: colors.borderCreamSoft,
      backgroundColor: colors.white,
      maxWidth: s(170),
    },
    bindChipActive: {
      backgroundColor: colors.amber,
      borderColor: colors.gold,
    },
    bindChipText: {
      fontFamily: fonts.headingMedium,
      fontSize: ms(12),
      color: colors.textMuted,
    },
    bindChipTextActive: {
      color: colors.textDark,
    },
    formActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: s(8),
      marginTop: s(16),
    },
    formCancelBtn: {
      paddingVertical: s(11),
      paddingHorizontal: s(18),
      minHeight: s(44),
      justifyContent: 'center',
      borderRadius: s(10),
      borderWidth: 1.5,
      borderColor: colors.borderCreamSoft,
      backgroundColor: 'transparent',
    },
    formCancelText: {
      fontFamily: fonts.heading,
      fontSize: ms(12),
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.textMuted,
    },
    formSaveBtn: {
      paddingVertical: s(11),
      paddingHorizontal: s(24),
      minHeight: s(44),
      justifyContent: 'center',
      borderRadius: s(10),
      backgroundColor: colors.gold,
      shadowColor: colors.gold,
      shadowOffset: { width: 0, height: s(6) },
      shadowOpacity: 0.35,
      shadowRadius: s(12),
      elevation: 4,
    },
    formSaveText: {
      fontFamily: fonts.heading,
      fontSize: ms(12),
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.creamCard,
    },
    formSaveBtnBusy: {
      opacity: 0.85,
    },
    savingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(8),
    },

    // ---- Foto do produto ----
    photoRow: {
      flexDirection: 'row',
      gap: s(12),
      alignItems: 'center',
      marginBottom: s(12),
    },
    photoBox: {
      width: s(68),
      height: s(68),
      borderRadius: s(14),
      borderWidth: 1.5,
      borderColor: colors.borderCreamSoft,
      backgroundColor: colors.creamPanel,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    photoImg: {
      width: '100%',
      height: '100%',
    },
    photoLabel: {
      fontFamily: fonts.heading,
      fontSize: ms(11),
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.goldDeepAlt,
    },
    photoHint: {
      fontSize: ms(12),
      color: colors.textFaint,
      fontFamily: fonts.body,
      marginTop: 2,
    },
    photoBtns: {
      flexDirection: 'row',
      gap: s(8),
      marginTop: s(8),
    },
    photoBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(5),
      paddingVertical: s(8),
      paddingHorizontal: s(12),
      borderRadius: s(9),
      borderWidth: 1,
      borderColor: colors.borderCreamSoft,
      backgroundColor: colors.white,
    },
    photoBtnText: {
      fontFamily: fonts.heading,
      fontSize: ms(11),
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: colors.goldDeep,
    },
    photoBtnDanger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(5),
      paddingVertical: s(8),
      paddingHorizontal: s(12),
      borderRadius: s(9),
      borderWidth: 1,
      borderColor: colors.dangerBorder,
      backgroundColor: colors.dangerBg,
    },
    photoBtnDangerText: {
      fontFamily: fonts.heading,
      fontSize: ms(11),
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: colors.danger,
    },
  });
}
