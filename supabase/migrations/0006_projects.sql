-- Projects: notes, the parts a build needs (from inventory or still to get), and a generated wiring diagram.
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 2000),
  status      text not null default 'idea' check (status in ('idea', 'building', 'done', 'shelved')),
  notes       text check (char_length(notes) <= 20000),
  diagram     jsonb,   -- { parts, nets, notes, generated_at }, written by the project-diagram function
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index projects_user_idx on public.projects (user_id, updated_at desc);

-- One row per part a project needs. item_id is null for a part that is not in the inventory (yet), or whose
-- inventory item was deleted: name keeps what it was called, so it shows up as "not in inventory".
create table public.project_parts (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item_id    uuid references public.items(id) on delete set null,
  name       text not null check (char_length(name) between 1 and 120),
  quantity   integer not null default 1 check (quantity between 1 and 100000),
  role       text check (char_length(role) <= 300),   -- where it goes / what it does in this project
  used_at    timestamptz,                              -- set when the stock was taken from the inventory
  taken      integer check (taken is null or taken >= 0),  -- how many units were taken, so "put back" returns the same number
  created_at timestamptz not null default now()
);
create index project_parts_project_idx on public.project_parts (project_id, created_at);
create unique index project_parts_item_once on public.project_parts (project_id, item_id) where item_id is not null;

alter table public.projects enable row level security;
alter table public.project_parts enable row level security;
create policy "own projects" on public.projects
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "parts of own projects" on public.project_parts
  for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
    and (item_id is null or exists (select 1 from public.items i where i.id = item_id and i.user_id = auth.uid()))
  );

create or replace function public.touch_project() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger projects_touch before update on public.projects for each row execute function public.touch_project();
