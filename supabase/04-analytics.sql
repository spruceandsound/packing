-- Analytics (Oct 30, 2026). Safe to re-run.
-- activity: one row per person per day they open Pack (no page views, no content).
-- admins:   who can see the admin dashboard. Neither table is readable by the app directly.

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;

create table if not exists public.activity (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  primary key (user_id, day)
);
alter table public.activity enable row level security;
create index if not exists activity_day_idx on public.activity (day);

-- Record that the signed-in person used Pack today.
create or replace function public.touch_activity()
returns void language sql security definer set search_path = public as $$
  insert into public.activity (user_id, day)
  select auth.uid(), current_date where auth.uid() is not null
  on conflict do nothing;
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Everything the admin dashboard shows, in one call. Admins only.
create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  r jsonb;
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  select jsonb_build_object(
    'users',           (select count(*) from auth.users),
    'users_7d',        (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'active_1d',       (select count(distinct user_id) from public.activity where day = current_date),
    'active_7d',       (select count(distinct user_id) from public.activity where day > current_date - 7),
    'active_30d',      (select count(distinct user_id) from public.activity where day > current_date - 30),
    'returning_users', (select count(*) from (select user_id from public.activity group by user_id having count(*) >= 2) s),
    'trips',           (select count(*) from public.trips),
    'trips_7d',        (select count(*) from public.trips where created_at > now() - interval '7 days'),
    'repeat_planners', (select count(*) from (select owner_id from public.trips group by owner_id having count(*) >= 2) s),
    'shared_trips',    (select count(*) from (select trip_id from public.trip_members group by trip_id having count(*) > 1) s),
    'items',           (select count(*) from public.items),
    'items_packed',    (select count(*) from public.items where packed),
    'inventory_items', (select count(*) from public.closet_items),
    'templates',       (select count(*) from public.templates),
    'sorts_today',     (select coalesce(sum(count), 0) from public.ai_usage where day = current_date and user_id <> zero),
    'sorts_30d',       (select coalesce(sum(count), 0) from public.ai_usage where day > current_date - 30 and user_id <> zero),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'signups', (select count(*) from auth.users u where u.created_at::date = d.day),
        'active',  (select count(*) from public.activity a where a.day = d.day),
        'trips',   (select count(*) from public.trips t where t.created_at::date = d.day),
        'sorts',   (select coalesce(sum(x.count), 0) from public.ai_usage x where x.day = d.day and x.user_id <> zero)
      ) order by d.day)
      from (select generate_series(current_date - 29, current_date, interval '1 day')::date as day) d
    ),
    'people', (
      select coalesce(jsonb_agg(p.row order by p.joined desc), '[]'::jsonb)
      from (
        select u.created_at as joined, jsonb_build_object(
          'email', u.email,
          'joined', u.created_at,
          'last_active', (select max(a.day) from public.activity a where a.user_id = u.id),
          'days_active', (select count(*) from public.activity a where a.user_id = u.id),
          'trips', (select count(*) from public.trips t where t.owner_id = u.id),
          'sorts_30d', (select coalesce(sum(x.count), 0) from public.ai_usage x where x.user_id = u.id and x.day > current_date - 30)
        ) as row
        from auth.users u order by u.created_at desc limit 200
      ) p
    )
  ) into r;
  return r;
end $$;

revoke all on function public.touch_activity() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.touch_activity() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_stats() to authenticated;
revoke all on public.admins from anon, authenticated;
revoke all on public.activity from anon, authenticated;

-- Count everyone who has signed in so far as active on the day they last signed in.
insert into public.activity (user_id, day)
select id, last_sign_in_at::date from auth.users where last_sign_in_at is not null
on conflict do nothing;
