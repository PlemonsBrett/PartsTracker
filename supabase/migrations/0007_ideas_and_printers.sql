-- 3D printers join the test equipment list, so project ideas can include printed parts for the printers you own.
alter table public.tools drop constraint tools_kind_check;
alter table public.tools add constraint tools_kind_check
  check (kind in ('multimeter', 'oscilloscope', 'power_supply', 'soldering_iron', 'logic_analyzer', 'function_generator', 'lcr_meter', '3d_printer', 'other'));

-- Project ideas Claude suggested from the parts in stock. The idea is stored as written (and checked) when it was made;
-- how well it matches the inventory is worked out by the app each time it is shown.
create table public.project_ideas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  idea       jsonb not null,
  created_at timestamptz not null default now()
);
create index project_ideas_user_idx on public.project_ideas (user_id, created_at desc);

alter table public.project_ideas enable row level security;
create policy "own ideas" on public.project_ideas
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
