-- Who's bringing what, pack last, the trip ledger and day-before reminders (Oct 30, 2026).
-- Safe to re-run.

-- ───────────── items: assigned person + pack last ─────────────
alter table public.items add column if not exists assigned_to uuid references auth.users (id) on delete set null;
alter table public.items add column if not exists pack_last boolean not null default false;

-- Only people on the trip can be assigned.
create or replace function public.check_item_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.trip_members where trip_id = new.trip_id and user_id = new.assigned_to) then
    raise exception 'That person isn''t on this trip';
  end if;
  return new;
end $$;
revoke all on function public.check_item_assignee() from public, anon, authenticated;
drop trigger if exists items_check_assignee on public.items;
create trigger items_check_assignee before insert or update of assigned_to on public.items
  for each row execute function public.check_item_assignee();

-- When someone leaves a trip, their items go back to "anyone".
create or replace function public.unassign_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.items set assigned_to = null where trip_id = old.trip_id and assigned_to = old.user_id;
  return old;
end $$;
revoke all on function public.unassign_on_leave() from public, anon, authenticated;
drop trigger if exists trip_members_unassign on public.trip_members;
create trigger trip_members_unassign after delete on public.trip_members
  for each row execute function public.unassign_on_leave();

-- ───────────── ledger ─────────────
alter table public.trips add column if not exists currency text not null default 'USD';
do $$ begin alter table public.trips add constraint trips_currency check (currency ~ '^[A-Z]{3}$'); exception when duplicate_object then null; end $$;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  description text not null check (char_length(description) between 1 and 120),
  amount_cents integer not null check (amount_cents > 0 and amount_cents < 100000000),
  paid_by uuid not null references auth.users (id) on delete cascade,
  spent_on date not null default current_date,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists expenses_trip_idx on public.expenses (trip_id);

-- One row per person who shares an expense, including the payer (whose share is never "owed").
create table if not exists public.expense_shares (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0 and amount_cents < 100000000),
  paid_back boolean not null default false,
  paid_back_at timestamptz,
  primary key (expense_id, user_id)
);

create or replace function public.expense_trip(e uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select trip_id from public.expenses where id = e;
$$;
revoke all on function public.expense_trip(uuid) from public, anon;
grant execute on function public.expense_trip(uuid) to authenticated;

-- Payer and everyone sharing must be on the trip; shares can't add up to more than the expense.
create or replace function public.check_expense()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.trip_members where trip_id = new.trip_id and user_id = new.paid_by) then
    raise exception 'The person who paid isn''t on this trip';
  end if;
  return new;
end $$;
create or replace function public.check_share()
returns trigger language plpgsql security definer set search_path = public as $$
declare t uuid; total integer; amt integer;
begin
  select trip_id, amount_cents into t, amt from public.expenses where id = new.expense_id;
  if not exists (select 1 from public.trip_members where trip_id = t and user_id = new.user_id) then
    raise exception 'That person isn''t on this trip';
  end if;
  select coalesce(sum(amount_cents), 0) into total from public.expense_shares
   where expense_id = new.expense_id and user_id <> new.user_id;
  if total + new.amount_cents > amt then raise exception 'Shares add up to more than the expense'; end if;
  new.paid_back_at := case when new.paid_back then coalesce(new.paid_back_at, now()) else null end;
  return new;
end $$;
revoke all on function public.check_expense() from public, anon, authenticated;
revoke all on function public.check_share() from public, anon, authenticated;
drop trigger if exists expenses_check on public.expenses;
create trigger expenses_check before insert or update of paid_by, trip_id on public.expenses for each row execute function public.check_expense();
drop trigger if exists expense_shares_check on public.expense_shares;
create trigger expense_shares_check before insert or update on public.expense_shares for each row execute function public.check_share();

-- An expense can't move to a different trip.
create or replace function public.keep_expense_trip()
returns trigger language plpgsql set search_path = public as $$
begin new.trip_id := old.trip_id; new.created_by := old.created_by; return new; end $$;
revoke all on function public.keep_expense_trip() from public, anon, authenticated;
drop trigger if exists expenses_keep_trip on public.expenses;
create trigger expenses_keep_trip before update on public.expenses for each row execute function public.keep_expense_trip();

alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;
drop policy if exists "expenses: members" on public.expenses;
create policy "expenses: members" on public.expenses for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id) and created_by = auth.uid());
drop policy if exists "shares: members" on public.expense_shares;
create policy "shares: members" on public.expense_shares for all to authenticated
  using (public.is_trip_member(public.expense_trip(expense_id)))
  with check (public.is_trip_member(public.expense_trip(expense_id)));

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.expenses; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.expense_shares; exception when duplicate_object then null; end;
  end if;
end $$;

-- ───────────── reminders ─────────────
alter table public.profiles add column if not exists timezone text;
alter table public.profiles add column if not exists reminders boolean not null default true;
do $$ begin alter table public.profiles add constraint profiles_tz_len check (char_length(timezone) <= 64); exception when duplicate_object then null; end $$;
grant update (display_name, timezone, reminders) on public.profiles to authenticated;

create table if not exists public.reminders_sent (
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'day_before',
  sent_at timestamptz not null default now(),
  primary key (trip_id, user_id, kind)
);
alter table public.reminders_sent enable row level security;
revoke all on public.reminders_sent from anon, authenticated;

-- Trips starting tomorrow (in each person's own time zone), once it's 9am or later for them.
-- Server-only: the scheduled reminder function calls this with the service key.
create or replace function public.due_reminders()
returns table (trip_id uuid, user_id uuid, email text, display_name text, trip_name text, destination text,
               start_date date, end_date date, weather_summary text, items_total int, items_left int,
               mine_left int, pack_last text[])
language sql stable security definer set search_path = public as $$
  select t.id, m.user_id, u.email, p.display_name, t.name, t.destination, t.start_date, t.end_date,
         t.weather ->> 'summary',
         (select count(*) from public.items i where i.trip_id = t.id)::int,
         (select count(*) from public.items i where i.trip_id = t.id and not i.packed)::int,
         (select count(*) from public.items i where i.trip_id = t.id and not i.packed and i.assigned_to = m.user_id)::int,
         array(select i.name from public.items i where i.trip_id = t.id and i.pack_last and not i.packed
                 and (i.assigned_to is null or i.assigned_to = m.user_id) order by i.position limit 12)
  from public.trips t
  join public.trip_members m on m.trip_id = t.id
  join auth.users u on u.id = m.user_id
  join public.profiles p on p.id = m.user_id
  cross join lateral (select coalesce((select n.name from pg_timezone_names n where n.name = p.timezone limit 1), 'America/Los_Angeles') as tz) z
  where p.reminders
    and u.email is not null
    and t.start_date = ((now() at time zone z.tz)::date + 1)
    and extract(hour from (now() at time zone z.tz)) >= 9
    and not exists (select 1 from public.reminders_sent r where r.trip_id = t.id and r.user_id = m.user_id and r.kind = 'day_before');
$$;
revoke all on function public.due_reminders() from public, anon, authenticated;
