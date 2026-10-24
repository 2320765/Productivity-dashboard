create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_low < user_high), check (requested_by in (user_low, user_high)),
  unique (user_low, user_high)
);
create index if not exists friendships_high_idx on public.friendships(user_high, status, created_at desc);
create index if not exists friendships_requester_idx on public.friendships(requested_by, status, created_at desc);
alter table public.friendships enable row level security;
drop policy if exists "Users can view their own friendship rows" on public.friendships;
create policy "Users can view their own friendship rows" on public.friendships
  for select to authenticated using (auth.uid() in (user_low, user_high));
drop policy if exists "Users can delete their own friendship rows" on public.friendships;
create policy "Users can delete their own friendship rows" on public.friendships
  for delete to authenticated using (auth.uid() in (user_low, user_high));
revoke all on public.friendships from anon, public;
grant select, delete on public.friendships to authenticated;

create table if not exists public.friend_lookup_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.friend_lookup_log enable row level security;
revoke all on public.friend_lookup_log from anon, public, authenticated;

create or replace function public.lookup_friend(p_query text)
returns table(user_id uuid, display_name text, avatar_url text)
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare caller uuid := auth.uid(); last_lookup timestamptz;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if char_length(trim(coalesce(p_query, ''))) < 3 or char_length(p_query) > 320 then
    raise exception 'Enter an exact email or display name (at least 3 characters)' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  select max(log_row.created_at) into last_lookup from public.friend_lookup_log log_row where log_row.user_id = caller;
  if last_lookup > now() - interval '3 seconds' then raise exception 'Please wait before searching again' using errcode = 'P0001'; end if;
  insert into public.friend_lookup_log(user_id) values (caller);
  return query
  select account.id,
    coalesce(nullif(account.raw_user_meta_data ->> 'full_name', ''), nullif(account.raw_user_meta_data ->> 'name', '')),
    nullif(account.raw_user_meta_data ->> 'avatar_url', '')
  from auth.users account where account.id <> caller and (
    (account.email is not null and lower(account.email) = lower(trim(p_query))) or
    lower(coalesce(nullif(account.raw_user_meta_data ->> 'full_name', ''), nullif(account.raw_user_meta_data ->> 'name', ''))) = lower(trim(p_query))
  ) and coalesce(nullif(account.raw_user_meta_data ->> 'full_name', ''), nullif(account.raw_user_meta_data ->> 'name', '')) is not null
  limit 1;
end;
$$;

create or replace function public.send_friend_request(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare caller uuid := auth.uid(); pair_low uuid; pair_high uuid; result_id uuid;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_user_id is null or p_user_id = caller then raise exception 'Cannot add yourself' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users account where account.id = p_user_id) then raise exception 'User not found' using errcode = 'P0002'; end if;
  pair_low := least(caller, p_user_id); pair_high := greatest(caller, p_user_id);
  insert into public.friendships(user_low, user_high, requested_by, status)
  values (pair_low, pair_high, caller, 'pending') on conflict (user_low, user_high) do nothing returning id into result_id;
  if result_id is null then raise exception 'A request or friendship already exists' using errcode = '23505'; end if;
  return result_id;
end;
$$;

create or replace function public.respond_friend_request(p_friendship_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_accept then
    update public.friendships set status = 'accepted', updated_at = now()
    where id = p_friendship_id and auth.uid() in (user_low, user_high)
      and requested_by <> auth.uid() and status = 'pending';
  else
    delete from public.friendships where id = p_friendship_id and auth.uid() in (user_low, user_high)
      and requested_by <> auth.uid() and status = 'pending';
  end if;
  if not found then raise exception 'Friend request is unavailable' using errcode = '42501'; end if;
end;
$$;

create or replace function public.list_friends()
returns table(friendship_id uuid, user_id uuid, display_name text, avatar_url text,
              relation_status text, direction text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  return query
  select relation.id, other_user.id,
    coalesce(nullif(other_user.raw_user_meta_data ->> 'full_name', ''), nullif(other_user.raw_user_meta_data ->> 'name', ''), 'Пользователь'),
    nullif(other_user.raw_user_meta_data ->> 'avatar_url', ''), relation.status,
    case when relation.requested_by = auth.uid() then 'outgoing' else 'incoming' end,
    relation.created_at
  from public.friendships relation join auth.users other_user
    on other_user.id = case when relation.user_low = auth.uid() then relation.user_high else relation.user_low end
  where auth.uid() in (relation.user_low, relation.user_high) order by relation.created_at desc;
end;
$$;

revoke all on function public.lookup_friend(text) from public, anon;
revoke all on function public.send_friend_request(uuid) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.list_friends() from public, anon;
grant execute on function public.lookup_friend(text), public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean), public.list_friends() to authenticated;
