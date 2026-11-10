-- The test equipment each user owns, so test instructions can be written for their actual tools.
create table public.tools (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('multimeter', 'oscilloscope', 'power_supply', 'soldering_iron', 'logic_analyzer', 'function_generator', 'lcr_meter', 'other')),
  name       text not null check (char_length(name) between 1 and 80),   -- make and model, e.g. "FNIRSI DMT-99"
  notes      text check (char_length(notes) <= 600),                      -- specs and ratings
  created_at timestamptz not null default now()
);
create index tools_user_idx on public.tools (user_id, created_at);

alter table public.tools enable row level security;
create policy "own tools" on public.tools
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- What a part still needs investigating, the generated test plan, and which steps are done.
-- Shape: { "unknowns": [text], "plan"?: {...}, "done"?: [step index], "resolved"?: boolean }
alter table public.items add column investigation jsonb;
