-- Invite-only sign-up.
--
-- Google sign-in can't carry an invite code into account creation, so sign-up
-- stays open but a new account can't do anything until it redeems a code:
-- recipes and the assistant proxy (supabase/functions/groq) are limited to
-- members. Admins (the owner) create codes from the app. Codes are single-use
-- and expire after 14 days.

create table public.members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  is_admin   boolean not null default false,
  joined_at  timestamptz not null default now()
);

-- The first admin (the owner) is added by hand after their first sign-in:
--   insert into public.members (user_id, is_admin)
--     select id, true from auth.users where email = '<owner email>';

create table public.invites (
  code        text primary key check (code ~ '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  used_by     uuid unique references auth.users (id) on delete set null,
  used_at     timestamptz
);

-- Security definer so the row rules below can check membership without
-- granting reads on members to everyone.
create function public.is_member() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = (select auth.uid()));
$$;

create function public.is_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = (select auth.uid()) and is_admin);
$$;

-- Admins only. 48 random bits, shown as XXXX-XXXX-XXXX.
create function public.create_invite() returns public.invites
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  hex text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  inv public.invites;
begin
  if not public.is_admin() then
    raise exception 'Only admins can create invites' using errcode = '42501';
  end if;
  insert into public.invites (code, created_by)
    values (substr(hex, 1, 4) || '-' || substr(hex, 5, 4) || '-' || substr(hex, 9, 4), (select auth.uid()))
    returning * into inv;
  return inv;
end;
$$;

-- Asking for a code: someone signs in with Google and has no code, so they
-- leave a short message. Admins see the requests in the Invites dialog and send
-- a code by hand; nothing is emailed. One request per account (a second one
-- replaces the message). A request goes when its account redeems a code, is
-- dismissed by an admin, or is deleted.
create table public.access_requests (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  name        text not null default '',
  message     text not null default '' check (char_length(message) <= 500),
  created_at  timestamptz not null default now()
);

-- Signed in and not yet a member. Email and name come from the sign-in, not the
-- caller, so a request can't claim to be someone else.
create function public.request_access(p_message text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_member() then
    raise exception 'You already have access.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_message, '')) > 500 then
    raise exception 'Keep the message under 500 characters.' using errcode = 'P0001';
  end if;
  insert into public.access_requests (user_id, email, name, message)
    select u.id, coalesce(u.email, ''),
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''),
           trim(coalesce(p_message, ''))
    from auth.users u where u.id = uid
  on conflict (user_id) do update
    set message = excluded.message, created_at = now();
end;
$$;

revoke execute on function public.request_access(text) from public, anon;
grant execute on function public.request_access(text) to authenticated;

-- Makes the signed-in user a member and clears their access request. Accepts
-- the code with or without dashes, in any case.
create function public.redeem_invite(p_code text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  hex text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Fa-f]', '', 'g'));
  inv public.invites;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_member() then
    return;
  end if;
  select * into inv from public.invites
    where code = substr(hex, 1, 4) || '-' || substr(hex, 5, 4) || '-' || substr(hex, 9, 4)
    for update;
  if not found or length(hex) <> 12 then
    raise exception 'That invite code isn''t valid. Check it and try again.' using errcode = 'P0001';
  end if;
  if inv.used_at is not null then
    raise exception 'That invite code has already been used.' using errcode = 'P0001';
  end if;
  if inv.expires_at < now() then
    raise exception 'That invite code has expired. Ask for a new one.' using errcode = 'P0001';
  end if;
  update public.invites set used_by = uid, used_at = now() where code = inv.code;
  insert into public.members (user_id) values (uid);
  delete from public.access_requests where user_id = uid;
end;
$$;

-- Requesters read their own (to show "request sent"); admins read and dismiss.
-- Writes otherwise go through request_access.
alter table public.access_requests enable row level security;
grant select, delete on public.access_requests to authenticated;

create policy "access_requests: read own or admin"
  on public.access_requests for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));

create policy "access_requests: admins dismiss"
  on public.access_requests for delete to authenticated
  using ((select public.is_admin()));

-- Functions are executable by public by default; only signed-in users need these.
revoke execute on function public.is_member(), public.is_admin(), public.create_invite(),
  public.redeem_invite(text) from public, anon;
grant execute on function public.is_member(), public.is_admin(), public.create_invite(),
  public.redeem_invite(text) to authenticated;

-- Row rules. Users read their own membership (the app checks it after sign-in);
-- admins read invites to list them. All writes go through the functions above.
alter table public.members enable row level security;
alter table public.invites enable row level security;
grant select on public.members, public.invites to authenticated;

create policy "members: read own"
  on public.members for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "invites: admins can read"
  on public.invites for select to authenticated
  using ((select public.is_admin()));

-- Privacy basics: users can delete their own account, and accounts that
-- never redeem an invite are removed once a month.
--
-- Deleting the auth.users row removes everything the account owns: recipes,
-- membership, access request and assistant usage cascade. Invites it created or used
-- stay, with created_by / used_by set to null, so a used code can't be reused.

-- Deletes the signed-in user's account and data, right away. The last admin
-- can't delete themselves, so the app always keeps someone who can invite.
create function public.delete_my_account() returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_admin()
     and not exists (select 1 from public.members where is_admin and user_id <> uid) then
    raise exception 'You''re the only admin, so this account can''t be deleted.' using errcode = 'P0001';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Accounts that signed in but never redeemed an invite hold no data; they're
-- deleted once they're 30 days old. Returns how many were removed. Not callable
-- from the app; pg_cron runs it.
create function public.cleanup_unredeemed_accounts() returns integer
language sql volatile security definer
set search_path = ''
as $$
  with gone as (
    delete from auth.users u
    where u.created_at < now() - interval '30 days'
      and not exists (select 1 from public.members m where m.user_id = u.id)
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke execute on function public.cleanup_unredeemed_accounts() from public, anon, authenticated;

-- Monthly, on the 1st at 04:00 UTC. pg_cron is included in the free plan.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('cleanup-unredeemed-accounts', '0 4 1 * *',
  'select public.cleanup_unredeemed_accounts()');
