-- Venmo usernames, so trip-mates can pay each other back with the amount already filled in.
-- Stored without the @. Visible under the existing "self or trip-mates" profile policy.
alter table public.profiles add column if not exists venmo text;
do $$ begin
  alter table public.profiles add constraint profiles_venmo_fmt check (venmo is null or venmo ~ '^[A-Za-z0-9_-]{2,30}$');
exception when duplicate_object then null; end $$;
grant update (display_name, timezone, reminders, venmo) on public.profiles to authenticated;
