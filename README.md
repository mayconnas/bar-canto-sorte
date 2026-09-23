<div align="center">

<img src="assets/logo-canto-da-sorte.png" alt="Canto da Sorte" width="180" />

# PDV Canto da Sorte

**Ponto de venda offline-first para bar** — controle de mesas, comandas e
cardápio, feito para rodar em tablets Android atrás do balcão.

[![React Native](https://img.shields.io/badge/React_Native-0.86-20232A?logo=react&logoColor=61DAFB)](https://reactnative.dev)
[![Expo SDK](https://img.shields.io/badge/Expo_SDK-57-000020?logo=expo&logoColor=white)](https://docs.expo.dev/versions/v57.0.0/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-local_first-003B57?logo=sqlite&logoColor=white)](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/)
[![Supabase](https://img.shields.io/badge/Supabase-sync_opcional-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

---

> **O problema:** o Wi-Fi do bar cai no meio do sábado à noite. Um PDV que
> depende de internet trava junto — e a fila no balcão não espera.
>
> **A solução:** o app grava tudo no SQLite do próprio aparelho e trata a nuvem
> como um reforço opcional. Sem internet, ele funciona 100%. Quando a conexão
> volta, a fila de sincronização drena sozinha, em segundo plano.

## Screenshots

<!--
  TODO: substituir os placeholders abaixo pelos prints do tablet.
  Sugestão: criar a pasta docs/screenshots/ e salvar as imagens lá, por exemplo:

  | Mapa de mesas | Lançamento de pedido |
  |:---:|:---:|
  | <img src="docs/screenshots/mesas.png" width="400" /> | <img src="docs/screenshots/pedido.png" width="400" /> |

  | Checkout | Relatório de vendas |
  |:---:|:---:|
  | <img src="docs/screenshots/checkout.png" width="400" /> | <img src="docs/screenshots/relatorio.png" width="400" /> |
-->

| Mapa de mesas | Lançamento de pedido |
|:---:|:---:|
| _(screenshot em breve)_ | _(screenshot em breve)_ |

| Checkout | Relatório de vendas |
|:---:|:---:|
| _(screenshot em breve)_ | _(screenshot em breve)_ |

## Funcionalidades

- **Mapa de mesas** — cada mesa como card Livre/Ocupada, com contagem de itens
  e total da comanda em tempo real.
- **Lançamento de pedidos** — painel lateral com abas por categoria (Chopp,
  Porções…); tocar no produto adiciona à mesa selecionada.
- **Checkout** — ajuste de quantidades, total e forma de pagamento
  (Dinheiro, Pix, Débito, Crédito).
- **Cardápio** — criar/editar seções e produtos, marcar esgotado, **foto do
  produto** pela câmera ou galeria (com upload para o Supabase Storage).
- **Relatório de vendas** — total do dia, produtos mais vendidos e
  **exportação em PDF** (`expo-print`) para compartilhar.
- **Multi-aparelho** — 2 ou 3 tablets no mesmo bar, sincronizando entre si.

## Arquitetura: offline-first

```
┌─────────────────────────────────────────────────────────────┐
│                      APARELHO (tablet)                      │
│                                                             │
│   UI (React Native)                                         │
│        │                                                    │
│        ▼                                                    │
│   Zustand store ──────────┐                                 │
│        │                  │                                 │
│        ▼                  ▼                                 │
│   SQLite local  ──►  sync_queue                             │
│  (fonte da verdade)  (fila FIFO de operações pendentes)     │
│        ▲                  │                                 │
└────────┼──────────────────┼─────────────────────────────────┘
         │                  │
    aplica LWW         drena quando há rede
   (updated_at)             │
         │                  ▼
┌────────┴──────────────────────────────────────────┐
│                   SUPABASE                        │
│   Postgres  ·  Realtime  ·  Storage (fotos)       │
└───────────────────────────────────────────────────┘
         │
         └──► Realtime empurra a mudança para os OUTROS aparelhos
```

**Como funciona na prática:**

1. **O local manda.** Toda escrita (abrir mesa, lançar item, fechar conta)
   grava primeiro no SQLite via `expo-sqlite` — dentro de transação. A UI nunca
   espera a rede.
2. **Fila de sincronização.** A mesma escrita enfileira uma operação
   (`upsert`/`delete`) na tabela `sync_queue`, com o payload já mapeado para o
   schema remoto.
3. **Drenagem em segundo plano.** [`syncEngine.ts`](src/sync/syncEngine.ts)
   esvazia a fila periodicamente quando há rede. **Falha não perde dado:** o
   item permanece na fila e é retentado no ciclo seguinte.
4. **Tempo real.** [`realtime.ts`](src/sync/realtime.ts) escuta mudanças das
   outras estações e aplica localmente — a mesa que o garçom abriu aparece no
   balcão em segundos.
5. **Conflito resolvido por last-write-wins** (`updated_at`), com pull
   incremental por cursor. Adequado ao volume e ao ritmo de um bar de bairro.
6. **Degradação graciosa.** Sem credenciais configuradas,
   `isSupabaseConfigured()` retorna `false`, o status vira `'disabled'` e o app
   roda inteiramente local — **sem travar nem lançar erro**.

### Detalhes de implementação que valem nota

- **Sem loop de push.** O aparelho que escreveu também recebe o próprio evento
  do Realtime. `applyRemoteRow` grava no SQLite **sem** chamar `enqueue()`,
  então aplicar uma linha remota não reenfileira nada. A operação é idempotente
  (LWW: remoto == local ⇒ nada muda).
- **Tolerância a falha na subscrição.** Erro ao aplicar uma linha é logado e
  engolido, sem derrubar as demais tabelas/eventos.
- **Responsivo + adaptativo.** [`useScale`](src/theme/scale.ts) escala tamanhos;
  [`breakpoints.ts`](src/theme/breakpoints.ts) troca a *estrutura* do layout por
  faixa de tela — master-detail em tablet paisagem, empilhado em celular.
  O `width` é arredondado porque, no web, valores fracionários oscilantes
  recriavam estilos e derrubavam o foco dos inputs.
- **Camada de relatório pura.** [`reportPdf.ts`](src/utils/reportPdf.ts) recebe
  os dados prontos e devolve HTML — sem tocar banco nem estado, e com
  `generatedAt` como parâmetro, o que a mantém determinística e testável.
- **Índices onde importa:** `products(section_id)`, `order_items(table_id)`,
  `sales(closed_at)`, `sync_queue(created_at)`.

## Stack

| Camada | Tecnologia |
|---|---|
| App | React Native 0.86 · Expo SDK 57 · TypeScript 6 |
| Estado | Zustand (com selectors memoizados) |
| Banco local | SQLite (`expo-sqlite`) — fonte da verdade |
| Nuvem (opcional) | Supabase: Postgres · Realtime · Storage |
| Extras | `expo-print` (PDF) · `expo-image-picker` · `expo-network` |

## Como rodar

Pré-requisitos: [Node.js](https://nodejs.org) LTS e o app
[**Expo Go**](https://expo.dev/go) no celular Android.

```bash
# 1. Instalar as dependências
npm install

# 2. Configurar variáveis de ambiente (opcional — sem isso, roda offline)
cp .env.example .env   # no Windows: copy .env.example .env

# 3. Iniciar o servidor de desenvolvimento
npx expo start
```

Abra o **Expo Go**, escaneie o QR Code e o app carrega. Na primeira execução o
SQLite é criado e populado com o catálogo inicial ([`seed.ts`](src/data/seed.ts)).

> **Sem configurar nada, o app já funciona por completo** — em modo local.
> O Supabase é reforço, não requisito.

## Sincronização com o Supabase (opcional)

1. Crie um projeto em [supabase.com](https://supabase.com) (o plano free basta).
2. No **SQL Editor**, rode [`supabase/schema-pdv.sql`](supabase/schema-pdv.sql).
3. Em **Project Settings > API**, copie a **Project URL** e a **anon public key**.
4. Cole no seu `.env`:

   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```

5. Reinicie o `npx expo start`. A sincronização passa a rodar sozinha.

O `.env` está no `.gitignore` — suas credenciais ficam só na sua máquina.
Guia passo a passo para quem nunca usou Supabase:
[`SETUP-SUPABASE.md`](./SETUP-SUPABASE.md).

> [!WARNING]
> Variáveis `EXPO_PUBLIC_` são embutidas **em texto puro** no bundle compilado.
> Use apenas a chave anônima, nunca a `service_role`. As policies de exemplo
> liberam acesso a `anon` para simplificar a instalação em rede local — para uso
> exposto à internet, restrinja-as a usuários autenticados.

## Gerar o APK

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleRelease     # no Windows: .\gradlew.bat assembleRelease
```

Requer **JDK 17** e o **Android SDK** instalados.

O APK sai em `android/app/build/outputs/apk/release/`. É assinado com a chave de
debug, suficiente para instalar direto nos aparelhos do bar (é preciso permitir
"instalar de fontes desconhecidas"). Para publicar na Play Store seria
necessária uma chave de assinatura própria — fora do escopo deste uso local.

## Estrutura

```
src/
  screens/     # MainScreen — mapa de mesas + painel de pedidos
  components/  # botões, badges, toasts e os modais (checkout, catálogo, relatório)
  store/       # Zustand: estado do PDV e selectors
  db/          # SQLite: schema, migrations, CRUD e a sync_queue
  sync/        # motor de sincronização, realtime, upload de imagem
  theme/       # cores, tipografia, escala e breakpoints
  types/       # tipos de domínio (Section, Product, Table, Sale...)
  data/        # catálogo inicial (seed)
  config/      # leitura das variáveis de ambiente
supabase/
  schema-pdv.sql       # tabelas, índices e RLS
  storage-produtos.sql # bucket das fotos de produto
```

## Licença

MIT — ver [`LICENSE`](./LICENSE). Desenvolvido para uso no bar Canto da Sorte e
publicado como portfólio.
