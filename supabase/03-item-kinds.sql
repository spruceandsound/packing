-- Item types and work/personal (Oct 30, 2026). Safe to re-run: the best-guess backfill
-- only runs the first time, when the column is created, so later edits are never overwritten.

do $$
begin
  -- kind: clothes / gear / essentials
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name = 'kind') then
    alter table public.items add column kind text not null default 'gear';
    update public.items set kind = case
      when category ~* '(cloth|apparel|outerwear|layer|footwear|shoe|underwear|sleepwear|swim|accessor|wear)' then 'clothes'
      when category ~* '(document|toiletr|hygiene|health|med|first aid|money|wallet|essential|personal care)' then 'essentials'
      else 'gear' end;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'closet_items' and column_name = 'kind') then
    alter table public.closet_items add column kind text not null default 'gear';
    update public.closet_items set kind = case
      when category ~* '(cloth|apparel|outerwear|layer|footwear|shoe|underwear|sleepwear|swim|accessor|wear)' then 'clothes'
      when category ~* '(document|toiletr|hygiene|health|med|first aid|money|wallet|essential|personal care)' then 'essentials'
      else 'gear' end;
  end if;
end $$;

-- purpose: personal / work
alter table public.items add column if not exists purpose text not null default 'personal';
alter table public.closet_items add column if not exists purpose text not null default 'personal';

do $$ begin alter table public.items add constraint items_kind check (kind in ('clothes', 'gear', 'essentials')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.closet_items add constraint closet_kind check (kind in ('clothes', 'gear', 'essentials')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.items add constraint items_purpose check (purpose in ('personal', 'work')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.closet_items add constraint closet_purpose check (purpose in ('personal', 'work')); exception when duplicate_object then null; end $$;
