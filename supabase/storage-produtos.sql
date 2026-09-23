-- ============================================================================
-- Storage bucket "produtos" — fotos dos produtos do PDV Canto da Sorte
-- ============================================================================
-- Cria um bucket PÚBLICO (leitura livre das imagens) e libera upload/gestão
-- para a role anon (o app usa a anon key). Adequado para app interno do bar.
-- Rode uma vez; é idempotente.
-- ============================================================================

-- 1) Cria o bucket público, se ainda não existir.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'produtos',
  'produtos',
  true,
  5242880, -- 5 MB
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- 2) Policies na tabela storage.objects para o bucket "produtos".
--    Leitura pública + escrita/gestão pela anon (e authenticated).
drop policy if exists "produtos_read" on storage.objects;
create policy "produtos_read"
  on storage.objects for select
  to anon, authenticated, public
  using (bucket_id = 'produtos');

drop policy if exists "produtos_insert" on storage.objects;
create policy "produtos_insert"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'produtos');

drop policy if exists "produtos_update" on storage.objects;
create policy "produtos_update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'produtos')
  with check (bucket_id = 'produtos');

drop policy if exists "produtos_delete" on storage.objects;
create policy "produtos_delete"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'produtos');
