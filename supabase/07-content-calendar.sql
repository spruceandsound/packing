-- Admin-only content calendar (pack.spruceandsound.com/#/admin/content).
-- The marketing files are committed to /content as AES-256-GCM encrypted blobs. The key lives only
-- in this table (inserted by hand, never committed) and only admins can read it, through content_key().

create table if not exists public.app_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;  -- no policies: nobody reads it directly
revoke all on public.app_secrets from public, anon, authenticated;

create or replace function public.content_key()
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  return (select value from public.app_secrets where name = 'content_key');
end $$;
revoke all on function public.content_key() from public, anon;
grant execute on function public.content_key() to authenticated;

-- Which posts have gone out (shared across the admin's devices)
create table if not exists public.content_posted (
  post_id text primary key check (char_length(post_id) <= 40),
  posted_at timestamptz not null default now(),
  posted_by uuid references auth.users(id) on delete set null default auth.uid()
);
alter table public.content_posted enable row level security;
drop policy if exists "content_posted: admins" on public.content_posted;
create policy "content_posted: admins" on public.content_posted for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.content_posted from public, anon;
grant select, insert, delete on public.content_posted to authenticated;
