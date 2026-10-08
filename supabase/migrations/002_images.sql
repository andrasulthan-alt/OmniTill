-- =============================================================================
-- Photos for menu items and rooms (safe to run more than once)
-- Stored in a public Supabase Storage bucket "images". Anyone with the link can
-- view a photo; only managers and admins can add, replace or delete them.
-- =============================================================================
alter table public.products add column if not exists image_url text not null default ''
  check (image_url = '' or image_url ~ '^https?://');
alter table public.rooms add column if not exists image_url text not null default ''
  check (image_url = '' or image_url ~ '^https?://');

do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;   -- plain Postgres (tests): no Storage
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('images', 'images', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
                                 allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists omnitill_images_select on storage.objects';
  execute 'drop policy if exists omnitill_images_insert on storage.objects';
  execute 'drop policy if exists omnitill_images_update on storage.objects';
  execute 'drop policy if exists omnitill_images_delete on storage.objects';
  execute $p$create policy omnitill_images_select on storage.objects for select to authenticated
    using (bucket_id = 'images')$p$;
  execute $p$create policy omnitill_images_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'images' and (select public.ot_has('manager', 'admin')))$p$;
  execute $p$create policy omnitill_images_update on storage.objects for update to authenticated
    using (bucket_id = 'images' and (select public.ot_has('manager', 'admin')))
    with check (bucket_id = 'images' and (select public.ot_has('manager', 'admin')))$p$;
  execute $p$create policy omnitill_images_delete on storage.objects for delete to authenticated
    using (bucket_id = 'images' and (select public.ot_has('manager', 'admin')))$p$;
end $$;
