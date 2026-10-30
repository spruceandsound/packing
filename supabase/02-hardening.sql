-- Hardening after security review (Oct 30, 2026). Safe to re-run.

-- Invite links: members can create (with the default token and 14-day expiry only), read and delete them.
-- Nobody can edit an invite or pick their own token/expiry. When anyone leaves or is removed,
-- the trip's invite links are wiped so a removed person can't rejoin with an old link.
drop policy if exists "invites: members manage" on public.trip_invites;
drop policy if exists "invites: read" on public.trip_invites;
drop policy if exists "invites: create" on public.trip_invites;
drop policy if exists "invites: delete" on public.trip_invites;
create policy "invites: read" on public.trip_invites for select to authenticated using (public.is_trip_member(trip_id));
create policy "invites: create" on public.trip_invites for insert to authenticated with check (public.is_trip_member(trip_id) and created_by = auth.uid());
create policy "invites: delete" on public.trip_invites for delete to authenticated using (public.is_trip_member(trip_id));
revoke insert, update on public.trip_invites from authenticated;
grant insert (trip_id, created_by) on public.trip_invites to authenticated;

create or replace function public.drop_invites_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin delete from public.trip_invites where trip_id = old.trip_id; return old; end $$;
revoke all on function public.drop_invites_on_leave() from public, anon, authenticated;
drop trigger if exists trip_members_drop_invites on public.trip_members;
create trigger trip_members_drop_invites after delete on public.trip_members for each row execute function public.drop_invites_on_leave();

-- Profiles: people can change only their display name, not the email others see.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- Size limits so nobody can store huge rows.
do $$ begin
  alter table public.profiles add constraint profiles_name_len check (char_length(display_name) <= 60);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.trips add constraint trips_sizes check (
    pg_column_size(weather) < 20000 and pg_column_size(suggestions) < 5000
    and coalesce(array_length(bags, 1), 0) <= 12 and pg_column_size(bags) < 1500);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.items add constraint items_sizes check (
    char_length(qty) <= 40 and char_length(note) <= 200 and char_length(category) <= 40 and char_length(bag) <= 40);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.closet_items add constraint closet_sizes check (
    char_length(qty) <= 40 and char_length(note) <= 200 and char_length(category) <= 40);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.templates add constraint templates_sizes check (pg_column_size(items) < 60000 and coalesce(array_length(bags, 1), 0) <= 12);
exception when duplicate_object then null; end $$;
