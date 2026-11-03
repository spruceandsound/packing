-- Laundry list (Nov 2, 2026): flag items that need washing; the trip view can filter to them.
alter table public.items add column if not exists laundry boolean not null default false;
