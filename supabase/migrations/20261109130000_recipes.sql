-- Recipes: one table, per user (no shared catalogue). Each member reads and
-- writes only their own; an account that hasn't redeemed an invite gets
-- nothing. The share link (share_token) is used from Phase 3.

create table public.recipes (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title         text not null check (length(btrim(title)) between 1 and 200),
  summary       text,
  servings      integer,
  prep_minutes  integer,
  cook_minutes  integer,
  -- [{group, amount, unit, item, note}], units metric (see the design spec).
  ingredients   jsonb not null default '[]' check (jsonb_typeof(ingredients) = 'array'),
  -- [{text}]
  steps         jsonb not null default '[]' check (jsonb_typeof(steps) = 'array'),
  steps_origin  text not null default 'source' check (steps_origin in ('source', 'ai_suggested', 'user')),
  tags          text[] not null default '{}',
  notes         text,
  source_kind   text not null default 'text' check (source_kind in ('text', 'instagram', 'web', 'youtube')),
  source_url    text,
  source_author text,
  -- The raw pasted or fetched text, kept so a card can be re-parsed.
  source_text   text not null default '' check (length(source_text) <= 20000),
  starred       boolean not null default false,
  share_token   uuid unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index recipes_owner_created on public.recipes (owner, created_at desc);

create trigger recipes_updated_at before update on public.recipes
  for each row execute function public.set_updated_at();

alter table public.recipes enable row level security;

grant select, insert, update, delete on public.recipes to authenticated;

create policy "recipes: members use their own"
  on public.recipes for all to authenticated
  using (owner = (select auth.uid()) and public.is_member())
  with check (owner = (select auth.uid()) and public.is_member());
