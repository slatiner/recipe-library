-- Recipes: each member reads and writes only their own; newcomers without an
-- invite and signed-out visitors get nothing. Also the column checks, the
-- updated_at trigger and deletion with the account.
-- Creates throwaway users, so it runs against the local database only:
--   supabase start, then: npm run test:db
-- Rolls back at the end.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select * from no_plan();

-- ---- Fixtures: members a and b, a newcomer c ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@test'),
  ('00000000-0000-0000-0000-0000000000c1', 'c@test');
insert into public.members (user_id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b1');

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- ---- Signed out ----
set local role anon;
select throws_ok('select 1 from public.recipes', '42501', null, 'signed-out visitors cannot read recipes');

-- ---- Member a writes and reads their own ----
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ insert into public.recipes (title, ingredients, steps, tags)
  values ('Tomato soup', '[{"group":null,"amount":200,"unit":"g","item":"tomatoes","note":null}]', '[{"text":"Cook."}]', '{soup}') $$,
  'a member can add a recipe');
select results_eq('select title from public.recipes', array['Tomato soup'], 'a member reads their recipe back');
select is((select owner::text from public.recipes), '00000000-0000-0000-0000-0000000000a1', 'owner defaults to the caller');
select is((select steps_origin || '/' || source_kind || '/' || starred::text from public.recipes), 'source/text/false', 'defaults');
reset role;
update public.recipes set updated_at = now() - interval '1 day';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
update public.recipes set starred = true;
select ok((select updated_at > now() - interval '1 minute' from public.recipes), 'updated_at moves on update');

select throws_ok($$ insert into public.recipes (title) values ('   ') $$, '23514', null, 'an empty title is refused');
select throws_ok($$ insert into public.recipes (title, steps_origin) values ('x', 'x') $$, '23514', null, 'an unknown steps_origin is refused');
select throws_ok($$ insert into public.recipes (title, ingredients) values ('x', '{}') $$, '23514', null, 'ingredients must be an array');
select throws_ok($$ insert into public.recipes (title, source_text) values ('x', repeat('x', 20001)) $$, '23514', null, 'source text over 20,000 characters is refused');
select lives_ok($$ insert into public.recipes (title, image_url, image_source) values ('Pic', 'https://example.com/a.jpg', 'site') $$, 'an http(s) image link is kept');
select lives_ok($$ insert into public.recipes (title, image_url, image_source, image_credit, image_credit_url)
  values ('Stock', 'https://images.pexels.com/p.jpg', 'stock', 'Jane Doe', 'https://www.pexels.com/@jane') $$, 'a stock photo keeps its credit');
select throws_ok($$ insert into public.recipes (title, image_url) values ('x', 'https://example.com/a.jpg') $$, '23514', null, 'a photo must say where it came from');
select throws_ok($$ insert into public.recipes (title, image_credit) values ('x', 'Jane') $$, '23514', null, 'no credit without a photo');
select throws_ok($$ insert into public.recipes (title, image_url, image_source) values ('x', 'https://e.com/a.jpg', 'clipart') $$, '23514', null, 'an unknown image source is refused');
select throws_ok($$ insert into public.recipes (title, image_url, image_source, image_credit_url) values ('x', 'https://e.com/a.jpg', 'stock', 'javascript:x') $$, '23514', null, 'a non-http credit link is refused');
select throws_ok($$ insert into public.recipes (title, image_url, image_source) values ('x', 'javascript:alert(1)', 'site') $$, '23514', null, 'a non-http image link is refused');
select throws_ok($$ insert into public.recipes (title, image_url, image_source) values ('x', 'https://' || repeat('x', 2000), 'site') $$, '23514', null, 'an image link over 2,000 characters is refused');
select is((select status from public.recipes where title = 'Pic'), 'wishlist', 'a new recipe is a wish by default');
select is((select cooked_on from public.recipes where title = 'Pic'), null::date, 'a wish has no date cooked');
select lives_ok($$ insert into public.recipes (title, status, cooked_on) values ('Made', 'cooked', '2026-11-01') $$, 'a cooked recipe keeps its date');
select lives_ok($$ insert into public.recipes (title, status) values ('Made, no date', 'cooked') $$, 'the date cooked is optional');
select throws_ok($$ insert into public.recipes (title, status) values ('x', 'eaten') $$, '23514', null, 'an unknown status is refused');
select throws_ok($$ insert into public.recipes (title, status, cooked_on) values ('x', 'wishlist', '2026-11-01') $$, '23514', null, 'a wish cannot have a date cooked');

-- ---- Member b can't see or touch a's ----
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is_empty('select 1 from public.recipes', 'another member sees none of them');
select is_empty($$ update public.recipes set title = 'Mine' returning 1 $$, 'another member cannot update them');
select is_empty($$ delete from public.recipes returning 1 $$, 'another member cannot delete them');
select throws_ok($$ insert into public.recipes (owner, title) values ('00000000-0000-0000-0000-0000000000a1', 'Planted') $$,
  '42501', null, 'a member cannot add a recipe for someone else');

-- ---- A newcomer without an invite ----
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is_empty('select 1 from public.recipes', 'a newcomer sees nothing');
select throws_ok($$ insert into public.recipes (title) values ('x') $$, '42501', null, 'a newcomer cannot add recipes');

-- ---- Deleting the account deletes the recipes ----
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from public.recipes), 0, 'deleting the account deletes its recipes');

select * from finish();
rollback;
