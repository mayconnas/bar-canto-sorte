/**
 * Upload de fotos de produto para o Supabase Storage (bucket "produtos").
 *
 * Fluxo: o usuário escolhe/tira a foto -> comprimimos/redimensionamos com
 * expo-image-manipulator (para não subir imagens gigantes) -> enviamos ao bucket
 * público via a REST API do Storage -> retornamos a URL pública para gravar no
 * produto (campo imageUrl), que então sincroniza como o resto dos dados.
 *
 * OFFLINE-FIRST: o upload exige internet. Se estiver offline ou o Supabase não
 * estiver configurado, uploadProductImage() lança/retorna erro e a UI mantém o
 * produto sem foto (o usuário pode tentar de novo depois).
 */
import * as ImageManipulator from 'expo-image-manipulator';

import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from '../config/env';

const BUCKET = 'produtos';

/** Gera um nome de arquivo único e estável para a imagem. */
function fileName(productId: string, seed: number): string {
  // Sem Date.now()/random aqui para não depender de APIs proibidas em alguns
  // contextos; o seed vem de quem chama (ex.: length + índice). Mantém extensão jpg.
  return `p_${productId}_${seed}.jpg`;
}

/**
 * Redimensiona (máx. 800px de largura) e comprime a imagem para JPEG.
 * Retorna o URI local do arquivo processado.
 */
async function compress(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 800 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
  );
  return result.uri;
}

/**
 * Envia a imagem local (uri) ao bucket e retorna a URL pública.
 * @param localUri  URI da imagem escolhida (file:// do image-picker)
 * @param productId id do produto (para compor o caminho no bucket)
 * @param seed      número para tornar o nome único (ex.: produtos.length)
 */
export async function uploadProductImage(
  localUri: string,
  productId: string,
  seed: number,
): Promise<string> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado — foto indisponível offline.');
  }

  const processedUri = await compress(localUri);
  const path = `${productId}/${fileName(productId, seed)}`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;

  // Lê o arquivo local como blob para o corpo do upload.
  const fileResp = await fetch(processedUri);
  const blob = await fileResp.blob();

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'image/jpeg',
      // Permite sobrescrever caso o mesmo caminho seja reenviado.
      'x-upsert': 'true',
    },
    body: blob,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Falha ao enviar a foto (HTTP ${res.status}). ${text}`);
  }

  // URL pública (bucket é público).
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}
