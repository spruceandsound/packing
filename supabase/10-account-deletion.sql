-- Account deletion (Nov 2, 2026). Called by /api/delete-account with the service key, right before
-- the auth user is deleted (which cascades to everything else they own).
-- Keeps shared trips working for everyone else: trips the person owns pass to the member who joined
-- next, and expenses they logged for someone else stay (credited to the trip's new owner as creator).
create or replace function public.prepare_account_deletion(p_user uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare t record; heir uuid; moved integer := 0;
begin
  for t in select id from public.trips where owner_id = p_user loop
    select m.user_id into heir from public.trip_members m
     where m.trip_id = t.id and m.user_id <> p_user order by m.joined_at, m.user_id limit 1;
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
