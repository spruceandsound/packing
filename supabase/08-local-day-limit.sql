-- Smart sorts reset at midnight in each person's own time zone (profiles.timezone, which the app
-- keeps current). Unknown or missing time zones fall back to Pacific. The site-wide safety cap
-- still counts by UTC day.
create or replace function public.use_ai_sort(p_user uuid, p_limit integer, p_site_limit integer)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer; site integer; tz text; d date;
begin
  select coalesce((select z.name from pg_timezone_names z where z.name = p.timezone limit 1), 'America/Los_Angeles')
    into tz from public.profiles p where p.id = p_user;
  d := (now() at time zone coalesce(tz, 'America/Los_Angeles'))::date;

  insert into public.ai_usage (user_id, day, count) values ('00000000-0000-0000-0000-000000000000', current_date, 0)
  on conflict do nothing;
  select count into site from public.ai_usage
   where user_id = '00000000-0000-0000-0000-000000000000' and day = current_date for update;
  if site >= p_site_limit then return null; end if;

  insert into public.ai_usage (user_id, day, count) values (p_user, d, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
    where public.ai_usage.count < p_limit
  returning count into n;
  if n is null then return null; end if;

  update public.ai_usage set count = count + 1
   where user_id = '00000000-0000-0000-0000-000000000000' and day = current_date;
  return n;
end $$;
revoke all on function public.use_ai_sort(uuid, integer, integer) from public, anon, authenticated;
