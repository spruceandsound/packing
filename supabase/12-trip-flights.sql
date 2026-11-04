-- Trip dashboard flights (Nov 4, 2026). Anyone on a trip can see and edit its flights (one person often
-- books for the group). Live status is cached in `status` by /api/flight-status so everyone shares one lookup.
create table if not exists public.trip_flights (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,          -- who's flying (null = not set)
  direction text not null default 'out' check (direction in ('out', 'back', 'other')),
  flight_no text not null check (char_length(flight_no) between 2 and 12),
  flight_date date not null,
  dep_airport text not null default '' check (char_length(dep_airport) <= 40),
  arr_airport text not null default '' check (char_length(arr_airport) <= 40),
  dep_time text not null default '' check (dep_time = '' or dep_time ~ '^\d{2}:\d{2}$'),
  arr_time text not null default '' check (arr_time = '' or arr_time ~ '^\d{2}:\d{2}$'),
  note text not null default '' check (char_length(note) <= 200),
  status jsonb,
  status_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists trip_flights_trip_idx on public.trip_flights (trip_id, flight_date);
alter table public.trip_flights enable row level security;
drop policy if exists "flights: members" on public.trip_flights;
create policy "flights: members" on public.trip_flights for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id) and (user_id is null or exists (select 1 from public.trip_members m where m.trip_id = trip_flights.trip_id and m.user_id = trip_flights.user_id)));
-- Members edit the flight details; only the server writes the cached live status.
revoke update on public.trip_flights from authenticated;
grant update (user_id, direction, flight_no, flight_date, dep_airport, arr_airport, dep_time, arr_time, note) on public.trip_flights to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.trip_flights; exception when duplicate_object then null; end;
  end if;
end $$;
