# Como ligar o backup na nuvem (Supabase)

Este guia é para quem **não é programador** e só quer deixar o backup na
nuvem funcionando. Leva uns 10 minutos. Se pular esta parte, o PDV continua
funcionando normalmente — só não terá backup automático na internet.

Você vai precisar de: um computador com internet e um e-mail.

---

## Passo 1 — Criar sua conta no Supabase

1. Acesse **[supabase.com](https://supabase.com)** no navegador.
2. Clique em **"Start your project"** (ou "Sign Up").
3. Crie a conta com seu e-mail (ou com sua conta do Google/GitHub, o que for
   mais rápido).

## Passo 2 — Criar um projeto novo

1. Depois de entrar, clique em **"New project"**.
2. Escolha um nome, por exemplo: `canto-da-sorte`.
3. Crie uma **senha do banco de dados** (pode ser qualquer uma forte — anote
   num lugar seguro, mas você não vai precisar dela no dia a dia).
4. Escolha a região mais próxima do Brasil (ex.: "South America (São Paulo)").
5. Clique em **"Create new project"** e espere alguns minutos enquanto o
   Supabase prepara tudo (aparece uma barra de progresso).

## Passo 3 — Criar as tabelas (colar o schema.sql)

1. No menu do lado esquerdo, clique no ícone de **"SQL Editor"**.
2. Clique em **"New query"**.
3. Abra, no seu computador, o arquivo `supabase/schema.sql` que veio junto
   com o projeto do PDV (pode abrir com o Bloco de Notas ou qualquer editor
   de texto).
4. Selecione **todo o conteúdo** do arquivo (Ctrl+A) e copie (Ctrl+C).
5. Cole (Ctrl+V) tudo dentro do editor SQL do Supabase, na tela do navegador.
6. Clique no botão verde **"Run"** (ou aperte Ctrl+Enter).
7. Deve aparecer uma mensagem de sucesso ("Success. No rows returned"). Pronto
   — as tabelas do bar (mesas, produtos, seções, vendas) já existem na nuvem.

> Se aparecer algum erro dizendo que algo "já existe", pode ignorar — o
> script foi feito para poder ser rodado mais de uma vez sem problema.

## Passo 4 — Pegar as duas chaves de acesso

1. No menu do lado esquerdo, clique em **"Project Settings"** (ícone de
   engrenagem, geralmente no rodapé do menu).
2. Clique em **"API"**.
3. Você vai ver duas informações importantes:
   - **Project URL** — um endereço parecido com
     `https://algumacoisa.supabase.co`
   - **anon public** (dentro de "Project API keys") — uma chave de texto
     bem longa, começando com `eyJ...`
4. Copie os dois valores (tem um botão de copiar do lado de cada um).

## Passo 5 — Colar as chaves no app

1. Peça para quem instalou o app criar um arquivo chamado `.env` na pasta
   principal do projeto (pode copiar o `.env.example` que já vem junto e
   renomear).
2. Preencher as duas linhas com seus valores, ficando assim:

   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://algumacoisa.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...(sua chave longa aqui)...
   ```

3. Salvar o arquivo.

Pronto! Da próxima vez que o app for aberto (com internet disponível), ele já
começa a enviar os dados automaticamente para o Supabase, em segundo plano —
sem precisar fazer mais nada. Se a internet cair, o app continua funcionando
normalmente e envia tudo assim que a conexão voltar.

---

### Dúvidas comuns

**Preciso ficar entrando no site do Supabase todo dia?**
Não. Depois de configurado uma vez, é só usar o PDV normalmente no celular
ou tablet. O Supabase fica "escutando" nos bastidores.

**E se eu errar ao colar as chaves?**
Sem problema — o app detecta e volta a funcionar 100% local (sem nuvem) até
as chaves serem corrigidas. Nenhuma venda é perdida.

**É pago?**
O plano gratuito do Supabase é mais do que suficiente para um bar com 2-3
aparelhos. Se um dia o movimento crescer muito, o próprio Supabase avisa
quando for hora de considerar um plano pago.
