-- Where we're staying (Nov 4, 2026): one or more stays per trip, visible to and editable by everyone on it.
create table if not exists public.trip_stays (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  address text not null default '' check (char_length(address) <= 300),
  check_in_date date,
  check_in_time text not null default '' check (check_in_time = '' or check_in_time ~ '^\d{2}:\d{2}$'),
  check_out_date date,
  check_out_time text not null default '' check (check_out_time = '' or check_out_time ~ '^\d{2}:\d{2}$'),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists trip_stays_trip_idx on public.trip_stays (trip_id, check_in_date);
alter table public.trip_stays enable row level security;
drop policy if exists "stays: members" on public.trip_stays;
create policy "stays: members" on public.trip_stays for all to authenticated
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.trip_stays; exception when duplicate_object then null; end;
  end if;
end $$;
