-- Fact sheets: key specs parsed from a part's datasheet. The PDF itself is only stored as a fallback.
alter table public.items
  add column fact_sheet jsonb,            -- { summary, specs[{name,value}], features[], pinout, source_url, extracted_at }
  add column datasheet_path text,         -- storage object path, only when specs could not be extracted
  add column datasheet_status text check (datasheet_status in ('found', 'not_found')),
  add column datasheet_checked_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('datasheets', 'datasheets', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

-- Each user may only touch objects under their own folder: <user id>/<item id>.pdf
create policy "datasheets read own" on storage.objects for select to authenticated
  using (bucket_id = 'datasheets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "datasheets insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'datasheets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "datasheets update own" on storage.objects for update to authenticated
  using (bucket_id = 'datasheets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "datasheets delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'datasheets' and (storage.foldername(name))[1] = auth.uid()::text);
