-- PartsTracker schema. Every row belongs to a user; RLS keeps it private.
create table public.items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  category      text,
  quantity      integer not null default 0 check (quantity >= 0),
  min_quantity  integer not null default 0 check (min_quantity >= 0),
  location      text,
  part_number   text,
  manufacturer  text,
  value         text,          -- e.g. "10kΩ", "100nF", "3.3V"
  package       text,          -- e.g. "0805", "DIP-8", "TO-220"
  description   text,
  datasheet_url text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index items_user_idx on public.items (user_id, name);

-- Audit trail of quantity changes (written by trigger, so every client is covered).
create table public.inventory_events (
  id          bigint generated always as identity primary key,
  item_id     uuid not null references public.items(id) on delete cascade,
  user_id     uuid not null,
  delta       integer not null,
  quantity    integer not null,
  created_at  timestamptz not null default now()
);
create index inventory_events_item_idx on public.inventory_events (item_id, created_at desc);

create function public.set_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function public.log_quantity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into inventory_events (item_id, user_id, delta, quantity)
    values (new.id, new.user_id, new.quantity, new.quantity);
  elsif new.quantity is distinct from old.quantity then
    insert into inventory_events (item_id, user_id, delta, quantity)
    values (new.id, new.user_id, new.quantity - old.quantity, new.quantity);
  end if;
  return new;
end $$;

create trigger items_set_updated_at before update on public.items
  for each row execute function public.set_updated_at();
create trigger items_log_quantity after insert or update on public.items
  for each row execute function public.log_quantity();

-- Row level security: a user only ever sees their own rows.
alter table public.items enable row level security;
alter table public.inventory_events enable row level security;

create policy "own items" on public.items
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own events" on public.inventory_events
  for select to authenticated using (user_id = auth.uid());
