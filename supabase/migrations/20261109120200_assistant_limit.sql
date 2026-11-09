-- Per-user assistant limit. Every member shares the owner's Groq free
-- plan (1,000 requests a day for the whole organisation), so each member gets
-- 50 requests per UTC day. The Groq proxy (supabase/functions/groq) claims one
-- before each call. Same limit as Content_Project; revisit if the group grows.

create table public.assistant_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  count   integer not null default 0,
  primary key (user_id, day)
);
-- Written and read only through the function below.
alter table public.assistant_usage enable row level security;

-- Counts one request for the signed-in member and returns how many are left
-- today, or raises 'daily_limit' (P0001) once the 50 are used. Keeps one row
-- per user: earlier days are dropped.
create function public.claim_assistant_request() returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  today date := (now() at time zone 'utc')::date;
  daily_limit constant integer := 50;
  used integer;
begin
  if uid is null or not public.is_member() then
    raise exception 'Redeem an invite code to use the assistant.' using errcode = '42501';
  end if;
  delete from public.assistant_usage where user_id = uid and day < today;
  insert into public.assistant_usage (user_id, day, count) values (uid, today, 1)
    on conflict (user_id, day) do update set count = public.assistant_usage.count + 1
    where public.assistant_usage.count < daily_limit
    returning count into used;
  if used is null then
    raise exception 'daily_limit' using errcode = 'P0001',
      detail = format('All %s assistant requests for today are used. They reset at midnight UTC.', daily_limit);
  end if;
  return daily_limit - used;
end;
$$;

revoke execute on function public.claim_assistant_request() from public, anon;
grant execute on function public.claim_assistant_request() to authenticated;
