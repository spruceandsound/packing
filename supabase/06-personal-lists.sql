-- Personal lists inside shared trips (Oct 30, 2026). Safe to re-run.
-- items.personal_of = someone's own private item ("My list"); null = the shared "Group list".
-- Personal items are visible only to their owner. Group items can be assigned to a trip member.

alter table public.items add column if not exists personal_of uuid references auth.users (id) on delete cascade;
create index if not exists items_personal_idx on public.items (trip_id, personal_of);

-- Existing items on trips nobody else has joined become the planner's own list.
-- (Runs only while the column is new: items without an owner on solo trips.)
update public.items i set personal_of = m.user_id
from public.trip_members m
where m.trip_id = i.trip_id and i.personal_of is null
  and (select count(*) from public.trip_members x where x.trip_id = i.trip_id) = 1
  and not exists (select 1 from public.items y where y.personal_of is not null);

-- Owner of a personal item must be on the trip; personal items are never assigned to others.
create or replace function public.check_item_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.personal_of is not null then
    if not exists (select 1 from public.trip_members where trip_id = new.trip_id and user_id = new.personal_of) then
      raise exception 'That person isn''t on this trip';
    end if;
    new.assigned_to := null;
  end if;
  if new.assigned_to is not null and not exists (
    select 1 from public.trip_members where trip_id = new.trip_id and user_id = new.assigned_to) then
    raise exception 'That person isn''t on this trip';
  end if;
  return new;
end $$;
revoke all on function public.check_item_assignee() from public, anon, authenticated;
drop trigger if exists items_check_assignee on public.items;
create trigger items_check_assignee before insert or update on public.items
  for each row execute function public.check_item_assignee();

-- Leaving a trip removes your private list there and frees the group items you'd claimed.
create or replace function public.unassign_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.items set assigned_to = null where trip_id = old.trip_id and assigned_to = old.user_id;
  delete from public.items where trip_id = old.trip_id and personal_of = old.user_id;
  return old;
end $$;

-- Privacy: you see and change group items plus your own personal items, never someone else's.
drop policy if exists "items: members only" on public.items;
drop policy if exists "items: group or mine" on public.items;
create policy "items: group or mine" on public.items for all to authenticated
  using (public.is_trip_member(trip_id) and (personal_of is null or personal_of = auth.uid()))
  with check (public.is_trip_member(trip_id) and (personal_of is null or personal_of = auth.uid()));

-- Reminders count only what each person can see: the group list plus their own list.
create or replace function public.due_reminders()
returns table (trip_id uuid, user_id uuid, email text, display_name text, trip_name text, destination text,
               start_date date, end_date date, weather_summary text, items_total int, items_left int,
               mine_left int, pack_last text[])
language sql stable security definer set search_path = public as $$
  select t.id, m.user_id, u.email, p.display_name, t.name, t.destination, t.start_date, t.end_date,
         t.weather ->> 'summary',
         (select count(*) from public.items i where i.trip_id = t.id and (i.personal_of is null or i.personal_of = m.user_id))::int,
         (select count(*) from public.items i where i.trip_id = t.id and not i.packed and (i.personal_of is null or i.personal_of = m.user_id))::int,
         (select count(*) from public.items i where i.trip_id = t.id and not i.packed and (i.personal_of = m.user_id or i.assigned_to = m.user_id))::int,
         array(select i.name from public.items i where i.trip_id = t.id and i.pack_last and not i.packed
                 and (i.personal_of = m.user_id or (i.personal_of is null and (i.assigned_to is null or i.assigned_to = m.user_id)))
                 order by i.position limit 12)
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
