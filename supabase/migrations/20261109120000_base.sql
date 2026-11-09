-- Base: table privileges, the updated_at trigger function and the keep-alive row.
--
-- Supabase's defaults grant ALL on every new public table to anon and
-- authenticated. New tables start closed to the page's keys instead: each
-- migration that adds a table must enable RLS, add policies and grant what it
-- needs explicitly. service_role keeps its default grants.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- For tables with an updated_at column (recipes, Phase 1).
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Keep-alive target. Free Supabase projects pause after a week of low
-- activity. A scheduled GitHub Action reads this one-row table with the page's
-- public key. Everything else is closed to anon, so the job needs a table of its own.
create table public.keepalive (
  id smallint primary key default 1 check (id = 1),
  note text not null default 'read by .github/workflows/keepalive.yml'
);

insert into public.keepalive default values;

alter table public.keepalive enable row level security;

grant select on public.keepalive to anon;

create policy "keepalive: anyone can read"
  on public.keepalive for select to anon
  using (true);
