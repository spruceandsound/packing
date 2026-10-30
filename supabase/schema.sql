-- Pack (pack.spruceandsound.com) — Supabase database schema
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run: it only creates what's missing and replaces functions/policies.
--
-- Privacy model: every trip has members. You can only see or change a trip, its items
-- and its invite links if you're a member. Closet items and templates are yours alone.
-- AI usage counts are only touched by the server (service role), never by the app.

-- ───────────────────────── tables ─────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  destination text check (char_length(destination) <= 160),
  start_date date,
  end_date date,
  details text check (char_length(details) <= 1000),
  bags text[] not null default '{}',
  suggestions jsonb not null default '[]',
  weather jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index if not exists trip_members_user_idx on public.trip_members (user_id);

create table if not exists public.trip_invites (
  token text primary key default replace(gen_random_uuid()::text, '-', ''),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  qty text not null default '',
  note text not null default '',
  category text not null default 'Other',
  bag text not null default '',
  packed boolean not null default false,
  packed_by uuid references auth.users (id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_trip_idx on public.items (trip_id);

create table if not exists public.closet_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  qty text not null default '',
  note text not null default '',
  category text not null default 'Other',
  always boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists closet_owner_idx on public.closet_items (owner_id);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  bags text[] not null default '{}',
  items jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists templates_owner_idx on public.templates (owner_id);

-- AI sorts per user per day (server-only). The all-zeros user id holds the site-wide total.
create table if not exists public.ai_usage (
  user_id uuid not null,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);

-- ───────────────────────── helpers & triggers ─────────────────────────

create or replace function public.is_trip_member(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_members where trip_id = t and user_id = auth.uid());
$$;

create or replace function public.is_trip_owner(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trips where id = t and owner_id = auth.uid());
$$;

create or replace function public.shares_trip_with(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trip_members a
    join public.trip_members b on a.trip_id = b.trip_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trips_touch on public.trips;
create trigger trips_touch before update on public.trips for each row execute function public.touch_updated_at();
drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items for each row execute function public.touch_updated_at();

-- The creator of a trip becomes its owner-member automatically.
create or replace function public.add_trip_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members (trip_id, user_id, role) values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trips_add_owner on public.trips;
create trigger trips_add_owner after insert on public.trips for each row execute function public.add_trip_owner();

-- Ownership can't be handed over by editing the row.
create or replace function public.keep_trip_owner()
returns trigger language plpgsql as $$
begin new.owner_id := old.owner_id; return new; end $$;
drop trigger if exists trips_keep_owner on public.trips;
create trigger trips_keep_owner before update on public.trips for each row execute function public.keep_trip_owner();

-- A profile row for every new account.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Join a trip from an invite link.
create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select trip_id into t from public.trip_invites where token = p_token and expires_at > now();
  if t is null then raise exception 'This invite link has expired or was removed'; end if;
  insert into public.trip_members (trip_id, user_id, role) values (t, auth.uid(), 'editor') on conflict do nothing;
  return t;
end $$;

-- Count one AI sort; returns the new count, or null when a limit is reached. Server-only.
create or replace function public.use_ai_sort(p_user uuid, p_limit integer, p_site_limit integer)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer; site integer;
begin
  insert into public.ai_usage (user_id, day, count) values ('00000000-0000-0000-0000-000000000000', current_date, 0)
  on conflict do nothing;
  select count into site from public.ai_usage
   where user_id = '00000000-0000-0000-0000-000000000000' and day = current_date for update;
  if site >= p_site_limit then return null; end if;

  insert into public.ai_usage (user_id, day, count) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
    where public.ai_usage.count < p_limit
  returning count into n;
  if n is null then return null; end if;

  update public.ai_usage set count = count + 1
   where user_id = '00000000-0000-0000-0000-000000000000' and day = current_date;
  return n;
end $$;

-- ───────────────────────── row-level security ─────────────────────────

alter table public.profiles     enable row level security;
alter table public.trips        enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invites enable row level security;
alter table public.items        enable row level security;
alter table public.closet_items enable row level security;
alter table public.templates    enable row level security;
alter table public.ai_usage     enable row level security;   -- no policies: app can't touch it

drop policy if exists "profiles: self or trip-mates" on public.profiles;
create policy "profiles: self or trip-mates" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_trip_with(id));
drop policy if exists "profiles: edit self" on public.profiles;
create policy "profiles: edit self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "trips: members read" on public.trips;
create policy "trips: members read" on public.trips for select to authenticated
  using (owner_id = auth.uid() or public.is_trip_member(id));
drop policy if exists "trips: create own" on public.trips;
create policy "trips: create own" on public.trips for insert to authenticated
  with check (owner_id = auth.uid());
drop policy if exists "trips: members edit" on public.trips;
create policy "trips: members edit" on public.trips for update to authenticated
  using (public.is_trip_member(id)) with check (public.is_trip_member(id));
drop policy if exists "trips: owner deletes" on public.trips;
create policy "trips: owner deletes" on public.trips for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists "members: see trip-mates" on public.trip_members;
create policy "members: see trip-mates" on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id));
drop policy if exists "members: leave or owner removes" on public.trip_members;
create policy "members: leave or owner removes" on public.trip_members for delete to authenticated
  using ((user_id = auth.uid() and role <> 'owner') or (public.is_trip_owner(trip_id) and user_id <> auth.uid()));

drop policy if exists "invites: members manage" on public.trip_invites;
create policy "invites: members manage" on public.trip_invites for all to authenticated
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id) and created_by = auth.uid());

drop policy if exists "items: members only" on public.items;
create policy "items: members only" on public.items for all to authenticated
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

drop policy if exists "closet: own" on public.closet_items;
create policy "closet: own" on public.closet_items for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "templates: own" on public.templates;
create policy "templates: own" on public.templates for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Server-only functions
revoke all on function public.use_ai_sort(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;
revoke all on public.ai_usage from anon, authenticated;

-- ───────────────────────── live updates ─────────────────────────
-- Shared trips update live on every member's phone.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.items; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.trips; exception when duplicate_object then null; end;
  end if;
end $$;

-- ───────────────────────── tighten function access ─────────────────────────
alter function public.touch_updated_at() set search_path = public;
alter function public.keep_trip_owner() set search_path = public;
revoke all on function public.add_trip_owner() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.keep_trip_owner() from public, anon, authenticated;
-- Policy helpers: signed-in users need them for the privacy rules; nobody signed out does.
revoke all on function public.is_trip_member(uuid) from public, anon;
revoke all on function public.is_trip_owner(uuid) from public, anon;
revoke all on function public.shares_trip_with(uuid) from public, anon;
grant execute on function public.is_trip_member(uuid) to authenticated;
grant execute on function public.is_trip_owner(uuid) to authenticated;
grant execute on function public.shares_trip_with(uuid) to authenticated;
