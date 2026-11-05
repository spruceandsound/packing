-- Viewers (Nov 4, 2026). Safe to re-run.
-- A trip can now have viewers: family or friends who follow along but aren't packing.
-- Viewers see the trip's name, dates, destination, weather, notes, flights, stays and who's going.
-- They can't see packing lists or expenses, can't change anything, and can't invite anyone.
-- Travelers (owner + editors) work exactly as before.

-- ───────────── roles ─────────────
alter table public.trip_members drop constraint if exists trip_members_role_check;
alter table public.trip_members add constraint trip_members_role_check check (role in ('owner', 'editor', 'viewer'));

alter table public.trip_invites add column if not exists role text not null default 'editor';
do $$ begin
  alter table public.trip_invites add constraint trip_invites_role_check check (role in ('editor', 'viewer'));
exception when duplicate_object then null; end $$;
grant insert (trip_id, created_by, role) on public.trip_invites to authenticated;

-- A traveler: on the trip and allowed to pack, spend and edit.
create or replace function public.is_trip_editor(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_members where trip_id = t and user_id = auth.uid() and role <> 'viewer');
$$;
revoke all on function public.is_trip_editor(uuid) from public, anon;
grant execute on function public.is_trip_editor(uuid) to authenticated;

-- Joining uses the invite's role. A viewer who opens a traveler link becomes a traveler;
-- nobody is ever downgraded by opening a viewer link.
create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid; r text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select trip_id, role into t, r from public.trip_invites where token = p_token and expires_at > now();
  if t is null then raise exception 'This invite link has expired or was removed'; end if;
  insert into public.trip_members (trip_id, user_id, role) values (t, auth.uid(), coalesce(r, 'editor'))
  on conflict (trip_id, user_id) do update set role = 'editor'
    where public.trip_members.role = 'viewer' and excluded.role = 'editor';
  return t;
end $$;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- ───────────── who can change what ─────────────
drop policy if exists "trips: members edit" on public.trips;
create policy "trips: members edit" on public.trips for update to authenticated
  using (public.is_trip_editor(id)) with check (public.is_trip_editor(id));

-- Packing lists: travelers only (viewers can't even read them).
drop policy if exists "items: group or mine" on public.items;
create policy "items: group or mine" on public.items for all to authenticated
  using (public.is_trip_editor(trip_id) and (personal_of is null or personal_of = auth.uid()))
  with check (public.is_trip_editor(trip_id) and (personal_of is null or personal_of = auth.uid()));

-- Expenses: travelers only.
drop policy if exists "expenses: members" on public.expenses;
create policy "expenses: members" on public.expenses for all to authenticated
  using (public.is_trip_editor(trip_id))
  with check (public.is_trip_editor(trip_id) and created_by = auth.uid());
drop policy if exists "shares: members" on public.expense_shares;
create policy "shares: members" on public.expense_shares for all to authenticated
  using (public.is_trip_editor(public.expense_trip(expense_id)))
  with check (public.is_trip_editor(public.expense_trip(expense_id)));

-- Flights: everyone on the trip reads; travelers add, change and remove.
drop policy if exists "flights: members" on public.trip_flights;
drop policy if exists "flights: read" on public.trip_flights;
drop policy if exists "flights: add" on public.trip_flights;
drop policy if exists "flights: change" on public.trip_flights;
drop policy if exists "flights: remove" on public.trip_flights;
create policy "flights: read" on public.trip_flights for select to authenticated using (public.is_trip_member(trip_id));
create policy "flights: add" on public.trip_flights for insert to authenticated
  with check (public.is_trip_editor(trip_id) and (user_id is null or exists (select 1 from public.trip_members m
    where m.trip_id = trip_flights.trip_id and m.user_id = trip_flights.user_id and m.role <> 'viewer')));
create policy "flights: change" on public.trip_flights for update to authenticated
  using (public.is_trip_editor(trip_id))
  with check (public.is_trip_editor(trip_id) and (user_id is null or exists (select 1 from public.trip_members m
    where m.trip_id = trip_flights.trip_id and m.user_id = trip_flights.user_id and m.role <> 'viewer')));
create policy "flights: remove" on public.trip_flights for delete to authenticated using (public.is_trip_editor(trip_id));

-- Stays: everyone on the trip reads; travelers add, change and remove.
drop policy if exists "stays: members" on public.trip_stays;
drop policy if exists "stays: read" on public.trip_stays;
drop policy if exists "stays: write" on public.trip_stays;
drop policy if exists "stays: change" on public.trip_stays;
drop policy if exists "stays: remove" on public.trip_stays;
create policy "stays: read" on public.trip_stays for select to authenticated using (public.is_trip_member(trip_id));
create policy "stays: write" on public.trip_stays for insert to authenticated with check (public.is_trip_editor(trip_id));
create policy "stays: change" on public.trip_stays for update to authenticated
  using (public.is_trip_editor(trip_id)) with check (public.is_trip_editor(trip_id));
create policy "stays: remove" on public.trip_stays for delete to authenticated using (public.is_trip_editor(trip_id));

-- Invite links: travelers only.
drop policy if exists "invites: read" on public.trip_invites;
drop policy if exists "invites: create" on public.trip_invites;
drop policy if exists "invites: delete" on public.trip_invites;
create policy "invites: read" on public.trip_invites for select to authenticated using (public.is_trip_editor(trip_id));
create policy "invites: create" on public.trip_invites for insert to authenticated
  with check (public.is_trip_editor(trip_id) and created_by = auth.uid());
create policy "invites: delete" on public.trip_invites for delete to authenticated using (public.is_trip_editor(trip_id));

-- ───────────── viewers aren't travelers ─────────────
-- Items can't be assigned to (or kept as a personal list of) a viewer.
create or replace function public.check_item_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.personal_of is not null then
    if not exists (select 1 from public.trip_members where trip_id = new.trip_id and user_id = new.personal_of and role <> 'viewer') then
      raise exception 'That person isn''t on this trip';
    end if;
    new.assigned_to := null;
  end if;
  if new.assigned_to is not null and not exists (
    select 1 from public.trip_members where trip_id = new.trip_id and user_id = new.assigned_to and role <> 'viewer') then
    raise exception 'That person isn''t on this trip';
  end if;
  return new;
end $$;
revoke all on function public.check_item_assignee() from public, anon, authenticated;

-- Viewers don't pay for or share expenses.
create or replace function public.check_expense()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.trip_members where trip_id = new.trip_id and user_id = new.paid_by and role <> 'viewer') then
    raise exception 'The person who paid isn''t on this trip';
  end if;
  return new;
end $$;
create or replace function public.check_share()
returns trigger language plpgsql security definer set search_path = public as $$
declare t uuid; total integer; amt integer;
begin
  select trip_id, amount_cents into t, amt from public.expenses where id = new.expense_id;
  if not exists (select 1 from public.trip_members where trip_id = t and user_id = new.user_id and role <> 'viewer') then
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

-- Day-before packing reminders go to travelers only.
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
  join public.trip_members m on m.trip_id = t.id and m.role <> 'viewer'
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

-- Deleting an account hands a shared trip to the next traveler, never to a viewer.
create or replace function public.prepare_account_deletion(p_user uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare t record; heir uuid; moved integer := 0;
begin
  for t in select id from public.trips where owner_id = p_user loop
    select m.user_id into heir from public.trip_members m
     where m.trip_id = t.id and m.user_id <> p_user and m.role <> 'viewer' order by m.joined_at, m.user_id limit 1;
    if heir is not null then
      update public.trips set owner_id = heir where id = t.id;
      update public.trip_members set role = 'owner' where trip_id = t.id and user_id = heir;
      moved := moved + 1;
    end if;
  end loop;
  update public.expenses e set created_by = tr.owner_id
    from public.trips tr
   where e.trip_id = tr.id and e.created_by = p_user and e.paid_by <> p_user and tr.owner_id <> p_user;
  return moved;
end $$;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;

-- What an invite link is for, so the join screen can say so before someone joins.
-- Gives away only the role and the trip's name, and only to a signed-in person holding a live link.
create or replace function public.invite_preview(p_token text)
returns table (role text, trip_name text) language sql stable security definer set search_path = public as $$
  select i.role, t.name from public.trip_invites i join public.trips t on t.id = i.trip_id
   where i.token = p_token and i.expires_at > now() and auth.uid() is not null;
$$;
revoke all on function public.invite_preview(text) from public, anon;
grant execute on function public.invite_preview(text) to authenticated;
