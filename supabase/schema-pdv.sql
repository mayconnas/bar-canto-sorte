-- ============================================================================
-- PDV Canto da Sorte — Schema ISOLADO "pdv" (Supabase self-hosted compartilhado)
-- ============================================================================
-- Este script cria um schema separado chamado "pdv" para NÃO se misturar com as
-- outras tabelas do seu Supabase (qs_*, doc_*, chat_*, etc.). Todas as tabelas do
-- bar ficam agrupadas em pdv.* e podem ser removidas de uma vez no futuro com:
--     drop schema pdv cascade;
--
-- COMO RODAR: abra o Supabase Studio do seu projeto > SQL Editor
-- > New query > cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
--
-- IMPORTANTE (exposição na API): por padrão o PostgREST só expõe o schema "public".
-- Este script tenta expor o "pdv" automaticamente (ALTER ROLE ... db-schemas). Em
-- alguns setups self-hosted isso exige ajuste na variável PGRST_DB_SCHEMAS do
-- container (docker-compose/.env). Veja a NOTA no final se as tabelas não
-- aparecerem na API depois de rodar.
-- ============================================================================

create schema if not exists pdv;

-- Permissões: o app usa a anon key (role "anon"). Damos acesso ao schema pdv
-- para anon e authenticated. A segurança fina fica nas policies de RLS abaixo.
grant usage on schema pdv to anon, authenticated, service_role;
grant all on all tables in schema pdv to anon, authenticated, service_role;
grant all on all sequences in schema pdv to anon, authenticated, service_role;
alter default privileges in schema pdv
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema pdv
  grant all on sequences to anon, authenticated, service_role;


-- ============================================================================
-- 1) SECTIONS — seções do cardápio
-- ============================================================================
create table if not exists pdv.sections (
  id text primary key,
  label text not null,
  position integer not null default 0,
  deleted boolean not null default false,
  updated_at bigint not null default 0
);
create index if not exists pdv_sections_updated_at_idx on pdv.sections (updated_at);

-- ============================================================================
-- 2) PRODUCTS — produtos do cardápio
-- ============================================================================
create table if not exists pdv.products (
  id text primary key,
  section_id text not null default '',
  name text not null,
  price numeric(10, 2) not null default 0,
  icon text not null default '',
  image_url text not null default '',
  available boolean not null default true,
  position integer not null default 0,
  deleted boolean not null default false,
  updated_at bigint not null default 0
);
-- Migration para instalações que já criaram a tabela sem image_url:
alter table pdv.products add column if not exists image_url text not null default '';
alter table pdv.products alter column section_id set default '';
create index if not exists pdv_products_updated_at_idx on pdv.products (updated_at);
create index if not exists pdv_products_section_id_idx on pdv.products (section_id);

-- ============================================================================
-- 3) TABLES — mesas/comandas
-- ============================================================================
create table if not exists pdv.tables (
  id text primary key,
  num text not null,
  name text not null,
  status text not null default 'livre',
  opened_at bigint,
  deleted boolean not null default false,
  updated_at bigint not null default 0,
  constraint pdv_tables_status_check check (status in ('livre', 'ocupada'))
);
create index if not exists pdv_tables_updated_at_idx on pdv.tables (updated_at);

-- ============================================================================
-- 4) ORDER_ITEMS — itens lançados nas comandas
-- ============================================================================
create table if not exists pdv.order_items (
  id text primary key,
  table_id text,
  product_id text,
  name text not null,
  price numeric(10, 2) not null default 0,
  qty integer not null default 1,
  deleted boolean not null default false,
  updated_at bigint not null default 0
);
create index if not exists pdv_order_items_updated_at_idx on pdv.order_items (updated_at);
create index if not exists pdv_order_items_table_id_idx on pdv.order_items (table_id);

-- ============================================================================
-- 5) SALES — vendas finalizadas (relatório do dia)
-- ============================================================================
create table if not exists pdv.sales (
  id text primary key,
  table_id text not null,
  table_name text not null,
  items_json text not null default '[]',
  total numeric(10, 2) not null default 0,
  payment text not null,
  closed_at bigint not null,
  synced boolean not null default false,
  updated_at bigint not null default 0,
  constraint pdv_sales_payment_check check (payment in ('dinheiro', 'pix', 'debito', 'credito'))
);
create index if not exists pdv_sales_updated_at_idx on pdv.sales (updated_at);
create index if not exists pdv_sales_closed_at_idx on pdv.sales (closed_at);


-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
-- O app conecta com a ANON key (role "anon"), SEM login de usuário. Por isso as
-- policies liberam leitura e escrita para "anon" (e "authenticated"). É adequado
-- para um app interno de 2-3 aparelhos do próprio bar, cuja anon key só circula
-- dentro do APK distribuído por você.
--
-- Se um dia quiser blindar mais (ex.: exigir login dos funcionários), troque o
-- role "anon" por "authenticated" nas policies e ative Auth no app.
-- ============================================================================
alter table pdv.sections    enable row level security;
alter table pdv.products    enable row level security;
alter table pdv.tables      enable row level security;
alter table pdv.order_items enable row level security;
alter table pdv.sales       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sections','products','tables','order_items','sales'] loop
    execute format('drop policy if exists "%s_rw" on pdv.%I', t, t);
    execute format(
      'create policy "%s_rw" on pdv.%I for all to anon, authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;


-- ============================================================================
-- NOTA — SE AS TABELAS NÃO APARECEREM NA API (erro "schema pdv not exposed"):
-- ----------------------------------------------------------------------------
-- O PostgREST precisa listar o schema "pdv" em PGRST_DB_SCHEMAS. Duas opções:
--
--  (A) Via SQL (funciona em muitos setups) — rode e recarregue o PostgREST:
--        alter role authenticator set pgrst.db_schemas = 'public, pdv, storage';
--        notify pgrst, 'reload config';
--
--  (B) Via container (mais garantido) — no docker-compose/.env do Supabase,
--      ajuste a variável do serviço "rest":
--        PGRST_DB_SCHEMAS=public,pdv,storage
--      e reinicie o container do PostgREST (supabase-rest / rest).
--
-- Depois disso, o app acessa as tabelas passando o header Accept-Profile: pdv
-- (o cliente do app já está configurado para usar o schema "pdv").
-- ============================================================================
