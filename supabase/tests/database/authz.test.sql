-- Authorization tests: a new account can't do anything until it redeems an
-- invite, members see only their own membership, only admins create invites,
-- signed-out visitors reach only the keep-alive row. Also the assistant daily
-- limit, account deletion and the monthly cleanup of unredeemed accounts.
-- Creates throwaway users, so it runs against the local database only:
--   supabase start, then: npm run test:db
-- Rolls back at the end.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select * from no_plan();

-- ---- Every table, including future ones ----

select is(
  (select array_agg(relname::text order by relname) from pg_class
    where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity),
  null, 'row-level security is on for every public table');

select is(
  (select array_agg(table_name || ':' || privilege_type order by 1) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'),
  array['keepalive:SELECT']::text[], 'signed-out visitors can only read keepalive');

select is(
  (select array_agg(table_name || ':' || privilege_type order by 1) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated'
      and privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  null, 'signed-in users have no TRUNCATE, REFERENCES, TRIGGER or MAINTAIN');

select is(
  (select array_agg(table_name || ':' || privilege_type order by 1) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and table_name in ('members', 'invites')
      and privilege_type <> 'SELECT'),
  null, 'members and invites are written only through the invite functions');

select is(
  (select array_agg(privilege_type::text order by privilege_type::text) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and table_name = 'access_requests'),
  array['DELETE', 'SELECT'], 'access requests are written only through request_access');

select is(
  (select array_agg(p.proname::text order by 1) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'execute')),
  array['get_shared_recipe'], 'signed-out visitors can call only get_shared_recipe (trigger functions aside)');

-- ---- Fixtures: an admin (a), a member (b), a newcomer without an invite (c) ----
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test', '{"full_name": "Ada Admin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'member@test', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'newcomer@test', '{}');
insert into public.members (user_id, is_admin) values
  ('00000000-0000-0000-0000-00000000000a', true),
  ('00000000-0000-0000-0000-00000000000b', false);

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
set local role authenticated;

-- ---- Members and invites, as a non-admin member ----
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select results_eq('select user_id::text from public.members', array['00000000-0000-0000-0000-00000000000b'],
  'a member sees only their own membership');
select throws_ok($$ update public.members set is_admin = true $$, '42501', null, 'a member cannot make themselves admin');
select throws_ok($$ insert into public.invites (code) values ('AAAA-BBBB-CCCC') $$, '42501', null,
  'a member cannot write an invite directly');
select throws_ok('select public.create_invite()', '42501', null, 'a non-admin cannot create invites');
select is_empty('select 1 from public.invites', 'a non-admin cannot see invites');

-- ---- A newcomer who hasn't redeemed an invite ----
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select ok(not public.is_member(), 'a newcomer is not a member');
select is_empty('select 1 from public.members', 'a newcomer sees no memberships');
select throws_ok($$ insert into public.members (user_id) values ('00000000-0000-0000-0000-00000000000c') $$, '42501', null,
  'a newcomer cannot add themselves to members');
select throws_ok('select public.create_invite()', '42501', null, 'a newcomer cannot create invites');

-- ---- Asking for a code: the newcomer requests, the admin sees it ----
select lives_ok($$ select public.request_access('First') $$, 'a newcomer can ask for a code');
select lives_ok($$ select public.request_access('  Second try  ') $$, 'asking again is allowed');
select results_eq($$ select email || '|' || message from public.access_requests $$, array['newcomer@test|Second try'],
  'one request per account: the email comes from sign-in and the new message replaces the old');
select throws_like($$ select public.request_access(repeat('x', 501)) $$, '%500%', 'a message over 500 characters is refused');
select throws_ok($$ insert into public.access_requests (user_id, email) values ('00000000-0000-0000-0000-00000000000c', 'x') $$,
  '42501', null, 'a request cannot be written directly');
select is_empty($$ delete from public.access_requests returning 1 $$, 'a requester cannot dismiss requests');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select throws_like($$ select public.request_access('x') $$, '%already have access%', 'a member cannot ask for a code');
select is_empty('select 1 from public.access_requests', 'a non-admin cannot see others'' requests');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select results_eq('select user_id::text from public.access_requests', array['00000000-0000-0000-0000-00000000000c'],
  'the admin sees requests');

-- ---- Invites: the admin creates, the newcomer redeems ----
select set_config('t.code', (public.create_invite()).code, true);
select set_config('t.old', (public.create_invite()).code, true);
select matches(current_setting('t.code'), '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$', 'an invite code looks like XXXX-XXXX-XXXX');
select is((select count(*)::int from public.invites), 2, 'the admin sees their invites');
reset role;
update public.invites set expires_at = now() - interval '1 day' where code = current_setting('t.old');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select throws_like($$ select public.redeem_invite('0000-0000-0000') $$, '%isn''t valid%', 'a wrong code is rejected');
select throws_like($$ select public.redeem_invite(current_setting('t.old')) $$, '%expired%', 'an expired code is rejected');
select lives_ok($$ select public.redeem_invite(lower(replace(current_setting('t.code'), '-', ''))) $$,
  'a valid code works in lower case without dashes');
select ok(public.is_member() and not public.is_admin(), 'redeeming makes a member, not an admin');
select is_empty('select 1 from public.access_requests', 'redeeming clears the account''s request');
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000010', 'second@test');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000010');
select throws_like($$ select public.redeem_invite(current_setting('t.code')) $$, '%already been used%',
  'a used code is rejected for someone else');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select lives_ok($$ select public.redeem_invite(current_setting('t.old')) $$,
  'redeeming as an existing member is a no-op');
reset role;
select is((select used_at from public.invites where code = current_setting('t.old')), null,
  '... and does not use up the code');

-- ---- Signed out ----
set local role anon;
select throws_ok('select 1 from public.members', '42501', null, 'signed out: members are refused');
select throws_ok('select 1 from public.invites', '42501', null, 'signed out: invites are refused');
select throws_ok('select 1 from public.access_requests', '42501', null, 'signed out: requests are refused');
select throws_ok($$ select public.redeem_invite('x') $$, '42501', null, 'signed out: cannot redeem');
select throws_ok($$ select public.request_access('x') $$, '42501', null, 'signed out: cannot ask for a code');
select is((select count(*)::int from public.keepalive), 1, 'signed out: the keep-alive row is readable');
select throws_ok('insert into public.keepalive (id) values (2)', '42501', null, 'signed out: keepalive is read-only');
reset role;

-- ---- Assistant daily limit ----
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000f', 'noinvite@test');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select is(public.claim_assistant_request(), 49, 'a member''s first assistant request of the day leaves 49');
reset role;
-- b used 49 yesterday and 49 today.
update public.assistant_usage set count = 49 where user_id = '00000000-0000-0000-0000-00000000000b';
insert into public.assistant_usage values ('00000000-0000-0000-0000-00000000000b', (now() at time zone 'utc')::date - 1, 49);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select is(public.claim_assistant_request(), 0, 'the 50th request is allowed');
select throws_ok('select public.claim_assistant_request()', 'P0001', 'daily_limit', 'the 51st request is refused');
select throws_ok('select 1 from public.assistant_usage', '42501', null, 'usage counts are not readable directly');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select throws_ok('select public.claim_assistant_request()', '42501', null, 'a newcomer without an invite cannot use the assistant');
reset role;
select is((select array_agg(count) from public.assistant_usage where user_id = '00000000-0000-0000-0000-00000000000b'),
  array[50], 'only today''s count is kept');

-- ---- Account deletion and cleanup ----
-- d signed in 40 days ago and never redeemed; e is a member just as old.
insert into auth.users (id, email, created_at) values
  ('00000000-0000-0000-0000-00000000000d', 'stale@test', now() - interval '40 days'),
  ('00000000-0000-0000-0000-00000000000e', 'oldmember@test', now() - interval '40 days');
insert into public.members (user_id) values ('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select throws_ok('select public.delete_my_account()', 'P0001', null, 'the only admin cannot delete their account');
select throws_ok('select public.cleanup_unredeemed_accounts()', '42501', null, 'signed-in users cannot run the cleanup');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select lives_ok('select public.delete_my_account()', 'a member can delete their account');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select lives_ok('select public.delete_my_account()', 'the member who used an invite can delete their account');
reset role;
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-00000000000b'), 0,
  'deleting an account removes the login');
select is((select count(*)::int from public.members where user_id = '00000000-0000-0000-0000-00000000000b')
  + (select count(*)::int from public.assistant_usage where user_id = '00000000-0000-0000-0000-00000000000b'), 0,
  'deleting an account removes its membership and usage');
select is((select used_by from public.invites where code = current_setting('t.code')), null, 'a used invite outlives its user, with used_by cleared');
select ok((select used_at is not null from public.invites where code = current_setting('t.code')),
  '... and stays used');
select is(public.cleanup_unredeemed_accounts(), 1, 'the cleanup removes one stale account');
select set_eq($$ select email::text from auth.users where id::text like '00000000-0000-0000-0000-0000000000%' $$,
  array['admin@test', 'noinvite@test', 'oldmember@test', 'second@test'],
  'the cleanup keeps members and accounts under 30 days old');
select is((select schedule from cron.job where jobname = 'cleanup-unredeemed-accounts'), '0 4 1 * *',
  'the cleanup runs monthly');

select * from finish();
rollback;
