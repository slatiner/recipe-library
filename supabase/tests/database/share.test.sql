-- Share links: only the owner turns sharing on or off; anyone with the token
-- reads the public fields through get_shared_recipe, and nothing else.
-- Creates throwaway users, so it runs against the local database only:
--   supabase start, then: npm run test:db
-- Rolls back at the end.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select * from no_plan();

-- ---- Fixtures: members a and b, a newcomer c; a has a stock and a site photo recipe ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@test'),
  ('00000000-0000-0000-0000-0000000000c1', 'c@test');
insert into public.members (user_id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b1');
insert into public.recipes (id, owner, title, ingredients, steps, steps_origin, tags, status, cooked_on, starred,
                            image_url, image_source, image_credit, image_credit_url) values
  ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-0000000000a1', 'Tomato soup',
   '[{"group":null,"amount":200,"unit":"g","item":"tomatoes","note":null}]', '[{"text":"Cook."}]', 'ai_suggested', '{soup}',
   'cooked', '2026-11-01', true, 'https://images.example.com/p.jpg', 'stock', 'Jane Doe', 'https://example.com/@jane'),
  ('00000000-0000-0000-0000-00000000aaa2', '00000000-0000-0000-0000-0000000000a1', 'Site pie',
   '[]', '[]', 'source', '{}', 'wishlist', null, false, 'https://site.example.com/pie.jpg', 'site', null, null);

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
create temp table tokens (name text primary key, token uuid);
grant all on tokens to authenticated, anon;

-- ---- Owner shares ----
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into tokens values ('soup', public.share_recipe('00000000-0000-0000-0000-00000000aaa1'));
select isnt((select token from tokens where name = 'soup'), null, 'the owner gets a token');
select is(public.share_recipe('00000000-0000-0000-0000-00000000aaa1'), (select token from tokens where name = 'soup'),
  'sharing twice returns the same token');
insert into tokens values ('pie', public.share_recipe('00000000-0000-0000-0000-00000000aaa2'));

-- ---- Others can't share or unshare it ----
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.share_recipe('00000000-0000-0000-0000-00000000aaa1') $$, 'P0002', 'Recipe not found',
  'another member cannot share it');
select lives_ok($$ select public.stop_sharing('00000000-0000-0000-0000-00000000aaa1') $$, 'stop_sharing by another member does nothing');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.share_recipe('00000000-0000-0000-0000-00000000aaa1') $$, 'P0002', 'Recipe not found',
  'a newcomer cannot share it');

-- ---- A visitor reads the public fields ----
set local role anon;
select throws_ok('select 1 from public.recipes', '42501', null, 'signed-out visitors still cannot read recipes');
select is(public.get_shared_recipe((select token from tokens where name = 'soup')) ->> 'title', 'Tomato soup',
  'a visitor reads a shared recipe (and stop_sharing by another member left it shared)');
select is(public.get_shared_recipe((select token from tokens where name = 'soup')) ->> 'steps_origin', 'ai_suggested',
  'the AI badge comes through');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_shared_recipe((select token from tokens where name = 'soup'))) k
    where k in ('owner', 'id', 'source_text', 'starred', 'status', 'cooked_on', 'share_token', 'created_at', 'updated_at', 'image_source')),
  null, 'no private fields');
select is(public.get_shared_recipe((select token from tokens where name = 'soup')) ->> 'image_credit', 'Jane Doe',
  'a stock photo comes with its credit');
select is(public.get_shared_recipe((select token from tokens where name = 'soup')) ->> 'image_url', 'https://images.example.com/p.jpg',
  'a stock photo is shown');
select ok(not (public.get_shared_recipe((select token from tokens where name = 'pie')) ? 'image_url'),
  'a site photo is left out');
select is(public.get_shared_recipe('00000000-0000-0000-0000-000000000000'), null, 'an unknown token returns null');

-- ---- Owner stops sharing ----
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.stop_sharing('00000000-0000-0000-0000-00000000aaa1') $$, 'the owner stops sharing');
set local role anon;
select is(public.get_shared_recipe((select token from tokens where name = 'soup')), null, 'a revoked token returns null');

select * from finish();
rollback;
