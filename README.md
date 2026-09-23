# PDV Canto da Sorte

Aplicativo de ponto de venda (PDV) para o bar **Canto da Sorte**, feito para
rodar em tablets/celulares Android atrás do balcão. Controla o mapa de mesas,
lançamento de pedidos, fechamento de conta e o cardápio (produtos e seções).

## Visão geral

- **Mapa de mesas**: cards mostrando cada mesa como Livre ou Ocupada, com
  contagem de itens e total da comanda.
- **Lançamento de pedidos**: painel lateral com abas por categoria (Chopp,
  Porções, etc.) — tocar num produto adiciona 1 unidade à mesa selecionada.
- **Checkout**: tela de fechamento com ajuste de quantidades, total e escolha
  da forma de pagamento (Dinheiro, Pix, Débito, Crédito).
- **Produtos & Seções**: gestão simples do cardápio (criar/editar/remover
  seções e produtos, marcar disponível/esgotado), com salvamento automático.
- **Vendas do dia**: total acumulado das vendas fechadas hoje, exibido no
  cabeçalho.

## Arquitetura: offline-first

O app foi desenhado para funcionar **sem depender de internet**:

1. **Fonte da verdade local**: todas as escritas (abrir mesa, lançar item,
   fechar conta, editar cardápio) gravam imediatamente no **SQLite** do
   próprio aparelho (`expo-sqlite`). O PDV continua funcionando 100% mesmo
   com o Wi-Fi caindo no meio do expediente.
2. **Fila de sincronização**: cada escrita local também é enfileirada
   (`sync_queue`) como uma operação pendente (`upsert` ou `delete`).
3. **Sincronização em segundo plano**: quando há internet, um motor de sync
   (`src/sync/syncEngine.ts`) drena essa fila periodicamente e envia os dados
   para o **Supabase** (Postgres na nuvem), que funciona como **backup e
   ponto de encontro** entre os aparelhos.
4. **Vários aparelhos**: pensado para uso com **2 a 3 aparelhos** no mesmo bar
   (ex.: um no balcão, um ou dois com os garçons). Cada um grava local e
   sincroniza; o último a gravar em cada registro "vence" (last-write-wins
   por `updated_at`) — adequado para o volume e ritmo de um bar de bairro.
5. **Sem Supabase configurado, sem problema**: se as credenciais no arquivo
   `.env` estiverem vazias ou ausentes, o app detecta isso automaticamente
   (`isSupabaseConfigured()`) e roda **inteiramente local**, sem travar nem
   lançar erros — a sincronização apenas fica "desligada".

Ou seja: o Supabase é um **reforço/backup em nuvem**, não uma dependência
obrigatória para o bar funcionar no dia a dia.

## Stack técnica

- [Expo](https://expo.dev) SDK 57 + React Native 0.86 + React 19
- TypeScript (modo estrito)
- `expo-sqlite` — banco local
- `@supabase/supabase-js` — sincronização/backup em nuvem (opcional)
- `@react-native-async-storage/async-storage` — persistência de sessão/config
- `zustand` — estado da aplicação
- `expo-network` — detecção de conectividade
- `@expo/vector-icons` (Feather) — ícones
- Fontes: `Pacifico` (marca), `Oswald` (títulos), `Manrope` (corpo de texto)
- Estilização com `StyleSheet` puro (sem NativeWind ou libs de UI externas)

## Como rodar em desenvolvimento

Pré-requisitos: [Node.js](https://nodejs.org) LTS instalado e o app
[**Expo Go**](https://expo.dev/go) no seu celular Android (disponível na
Play Store).

```bash
# 1. Instalar as dependências (só na primeira vez ou após mudar o package.json)
npm install

# 2. Configurar as variáveis de ambiente (opcional — sem isso o app roda offline)
cp .env.example .env   # no Windows: copy .env.example .env

# 3. Iniciar o servidor de desenvolvimento
npx expo start
```

Isso abre o **Metro Bundler** no terminal com um QR code. A partir daí:

- **Celular físico**: abra o app Expo Go e escaneie o QR code (celular e
  computador precisam estar na mesma rede Wi-Fi).
- **Emulador Android**: com o Android Studio e um emulador configurados,
  pressione a tecla **`a`** no terminal onde o `expo start` está rodando.
- **Recarregar**: pressione **`r`** no terminal para dar reload no app depois
  de alterar código.

Não é necessário nenhum passo extra de build para testar durante o
desenvolvimento — o Expo Go carrega o JavaScript diretamente.

## Como configurar o Supabase (sincronização em nuvem)

Este passo é **opcional** — o app funciona sem ele. Faça-o quando quiser que
os dados sejam salvos também na nuvem (backup) e/ou sincronizados entre mais
de um aparelho.

1. Crie uma conta gratuita em [supabase.com](https://supabase.com) e crie um
   **novo projeto**.
2. No painel do projeto, abra **SQL Editor** > **New query**.
3. Copie todo o conteúdo do arquivo [`supabase/schema.sql`](./supabase/schema.sql)
   deste repositório, cole no editor e clique em **Run**. Isso cria as
   tabelas `sections`, `products`, `tables`, `order_items` e `sales`, já com
   índices e Row Level Security (RLS) habilitados.
4. Vá em **Project Settings > API** e copie:
   - **Project URL** (algo como `https://xxxxxxxx.supabase.co`)
   - **anon public key** (uma chave longa, começa geralmente com `eyJ...`)
5. Copie `.env.example` para `.env` na raiz do projeto e cole os dois valores:

   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```

   O `.env` não é versionado (está no `.gitignore`), então suas credenciais
   ficam apenas na sua máquina.

6. Salve o arquivo e reinicie o `npx expo start`. A partir daí o app passa a
   sincronizar automaticamente em segundo plano sempre que houver internet.

Veja também o guia simplificado [`SETUP-SUPABASE.md`](./SETUP-SUPABASE.md),
pensado para quem nunca usou o Supabase antes.

## Como gerar o APK localmente (instalação direta no Android)

Para instalar o app em um tablet/celular do bar sem depender de loja de
aplicativos, gere um APK localmente:

### Pré-requisitos

- **JDK 17** instalado (Android Gradle exige essa versão).
- **Android SDK** instalado (via [Android Studio](https://developer.android.com/studio),
  que já traz o SDK Manager) e a variável de ambiente `ANDROID_HOME`
  apontando para ele.

### Passos

```bash
# 1. Gerar o projeto nativo Android (cria a pasta "android/")
npx expo prebuild

# 2. Entrar na pasta do projeto Android
cd android

# 3. Gerar o APK de release
./gradlew assembleRelease
```

No Windows, use `gradlew.bat assembleRelease` (sem o `./`) caso não esteja
usando Git Bash/WSL.

Ao final, o APK fica em:

```
android/app/build/outputs/apk/release/app-release.apk
```

Basta transferir esse arquivo para o aparelho (cabo USB, e-mail, etc.) e
instalar manualmente (é preciso permitir "instalar de fontes desconhecidas"
nas configurações do Android).

> **Observação**: por padrão o `assembleRelease` gera um APK assinado com uma
> chave de debug/automática do Gradle, suficiente para uso interno no próprio
> bar. Para publicar na Play Store futuramente, seria necessário configurar
> uma chave de assinatura própria — fora do escopo deste uso local.

## Estrutura de pastas (resumo)

```
src/
  theme/       # cores e tipografia (colors.ts, typography.ts)
  types/       # tipos de domínio compartilhados (Section, Product, Table...)
  data/        # catálogo inicial (seed.ts)
  config/      # leitura das variáveis de ambiente (env.ts)
  sync/        # motor de sincronização com o Supabase (opcional/degrada local)
  db/          # acesso ao SQLite local (fonte da verdade do app)
supabase/
  schema.sql   # script para criar as tabelas no Supabase
```

## Licença

MIT — ver [`LICENSE`](./LICENSE). Projeto desenvolvido para uso no bar
Canto da Sorte e publicado como portfólio.
