-- Rental cars (Nov 4, 2026). Safe to re-run. Run after 14-trip-viewers.sql.
-- Pickup and drop-off for each rental, shown on the overview and the trip calendar.
-- Everyone on the trip (viewers too) can see them; travelers add, change and remove.
create table if not exists public.trip_cars (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  company text not null check (char_length(company) between 1 and 80),
  pickup_place text not null default '' check (char_length(pickup_place) <= 200),
  pickup_date date,
  pickup_time text not null default '' check (pickup_time = '' or pickup_time ~ '^\d{2}:\d{2}$'),
  dropoff_place text not null default '' check (char_length(dropoff_place) <= 200),
  dropoff_date date,
  dropoff_time text not null default '' check (dropoff_time = '' or dropoff_time ~ '^\d{2}:\d{2}$'),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists trip_cars_trip_idx on public.trip_cars (trip_id, pickup_date);
alter table public.trip_cars enable row level security;
drop policy if exists "cars: read" on public.trip_cars;
drop policy if exists "cars: add" on public.trip_cars;
drop policy if exists "cars: change" on public.trip_cars;
drop policy if exists "cars: remove" on public.trip_cars;
create policy "cars: read" on public.trip_cars for select to authenticated using (public.is_trip_member(trip_id));
create policy "cars: add" on public.trip_cars for insert to authenticated
  with check (public.is_trip_editor(trip_id) and created_by = auth.uid());
create policy "cars: change" on public.trip_cars for update to authenticated
  using (public.is_trip_editor(trip_id)) with check (public.is_trip_editor(trip_id));
create policy "cars: remove" on public.trip_cars for delete to authenticated using (public.is_trip_editor(trip_id));
-- A car can't be moved to another trip or credited to someone else.
revoke update on public.trip_cars from authenticated;
grant update (company, pickup_place, pickup_date, pickup_time, dropoff_place, dropoff_date, dropoff_time, note) on public.trip_cars to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.trip_cars; exception when duplicate_object then null; end;
  end if;
end $$;
