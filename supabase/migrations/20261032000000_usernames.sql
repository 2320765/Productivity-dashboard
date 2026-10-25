-- Уникальные username. Профили не содержат email; чужие username отдаются только через usernames_for().
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z][a-z0-9_]{2,19}$')
);

create unique index if not exists profiles_username_unique on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (user_id = (select auth.uid()));

-- Прямые изменения запрещены: запись идёт только через set_username().
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;

create or replace function public.normalize_username(p_username text)
returns text language sql immutable set search_path = pg_catalog as $$
  select lower(regexp_replace(trim(coalesce(p_username, '')), '^@', ''));
$$;

create or replace function public.set_username(p_username text)
returns text language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare caller uuid := auth.uid(); clean text := public.normalize_username(p_username);
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if clean !~ '^[a-z][a-z0-9_]{2,19}$' then
    raise exception 'Invalid username format' using errcode = '22023';
  end if;
  if clean in ('admin','administrator','root','support','system','dayflow','null','undefined','moderator','owner','api') then
    raise exception 'Username is reserved' using errcode = '22023';
  end if;
  begin
    insert into public.profiles(user_id, username) values (caller, clean)
    on conflict (user_id) do update set username = excluded.username, updated_at = now();
  exception when unique_violation then
    raise exception 'Username already taken' using errcode = '23505';
  end;
  return clean;
end;
$$;

revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;

-- Username видны себе, друзьям (включая заявки), участникам общих пространств и сторонам приглашений.
create or replace function public.usernames_for(p_user_ids uuid[])
returns table(user_id uuid, username text)
language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if coalesce(array_length(p_user_ids, 1), 0) > 200 then raise exception 'Too many ids' using errcode = '22023'; end if;
  return query
  select p.user_id, p.username from public.profiles p
  where p.user_id = any(p_user_ids) and (
    p.user_id = caller
    or exists (select 1 from public.friendships f
               where f.user_low = least(caller, p.user_id) and f.user_high = greatest(caller, p.user_id))
    or exists (select 1 from public.workspace_members a
               join public.workspace_members b on b.workspace_id = a.workspace_id
               where a.user_id = caller and b.user_id = p.user_id)
    or exists (select 1 from public.workspace_invitations i
               where (i.invited_by = caller and i.invitee_id = p.user_id)
                  or (i.invitee_id = caller and i.invited_by = p.user_id))
  );
end;
$$;

revoke all on function public.usernames_for(uuid[]) from public, anon;
grant execute on function public.usernames_for(uuid[]) to authenticated;

-- Поиск друзей: точный username (с @ или без), точный email или точное имя.
drop function if exists public.lookup_friend(text);
create function public.lookup_friend(p_query text)
returns table(user_id uuid, display_name text, avatar_url text, username text)
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare caller uuid := auth.uid(); last_lookup timestamptz; q text := lower(trim(coalesce(p_query, '')));
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if char_length(q) < 3 or char_length(q) > 320 then
    raise exception 'Enter an exact username, email or display name (at least 3 characters)' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  select max(log_row.created_at) into last_lookup from public.friend_lookup_log log_row where log_row.user_id = caller;
  if last_lookup > now() - interval '3 seconds' then raise exception 'Please wait before searching again' using errcode = 'P0001'; end if;
  insert into public.friend_lookup_log(user_id) values (caller);
  return query
  select account.id,
    coalesce(nullif(account.raw_user_meta_data ->> 'full_name', ''), nullif(account.raw_user_meta_data ->> 'name', ''), 'Пользователь'),
    nullif(account.raw_user_meta_data ->> 'avatar_url', ''),
    prof.username
  from auth.users account
  left join public.profiles prof on prof.user_id = account.id
  where account.id <> caller and (
    prof.username = public.normalize_username(q) or
    (account.email is not null and lower(account.email) = q) or
    lower(coalesce(nullif(account.raw_user_meta_data ->> 'full_name', ''), nullif(account.raw_user_meta_data ->> 'name', ''), '')) = q
  )
  order by (prof.username = public.normalize_username(q)) desc nulls last
  limit 1;
end;
$$;

revoke all on function public.lookup_friend(text) from public, anon;
grant execute on function public.lookup_friend(text) to authenticated;

-- Приглашение по username: email приглашённого не читается и не сохраняется.
create or replace function public.send_workspace_invitation_by_username(p_workspace_id uuid, p_username text)
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare caller uuid := auth.uid(); target_id uuid; ws_name text;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not public.can_manage_workspace(p_workspace_id) then raise exception 'Workspace administrator permission required' using errcode = '42501'; end if;
  select user_id into target_id from public.profiles where username = public.normalize_username(p_username);
  if target_id is null then raise exception 'User not found' using errcode = 'P0002'; end if;
  if target_id = caller then raise exception 'Invalid invitee' using errcode = '22023'; end if;
  if exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = target_id) then
    raise exception 'Already a workspace member' using errcode = '23505';
  end if;
  if exists (select 1 from public.workspace_invitations where workspace_id = p_workspace_id and invitee_id = target_id and status = 'pending') then
    raise exception 'Invitation already pending' using errcode = '23505';
  end if;
  select name into ws_name from public.workspaces where id = p_workspace_id;
  insert into public.workspace_invitations(workspace_id, workspace_name, invited_by, invitee_id, invitee_email)
  values (p_workspace_id, ws_name, caller, target_id, '');
end;
$$;

revoke all on function public.send_workspace_invitation_by_username(uuid, text) from public, anon;
grant execute on function public.send_workspace_invitation_by_username(uuid, text) to authenticated;

-- Приглашения друзей больше не копируют email приглашённого.
create or replace function public.send_workspace_invitation_to_user(p_workspace_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare caller uuid := auth.uid(); ws_name text;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not public.can_manage_workspace(p_workspace_id) then raise exception 'Workspace administrator permission required' using errcode = '42501'; end if;
  if p_user_id is null or p_user_id = caller then raise exception 'Invalid invitee' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users where id = p_user_id) then raise exception 'User not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id) then raise exception 'Already a workspace member' using errcode = '23505'; end if;
  if exists (select 1 from public.workspace_invitations where workspace_id = p_workspace_id and invitee_id = p_user_id and status = 'pending') then raise exception 'Invitation already pending' using errcode = '23505'; end if;
  if not exists (select 1 from public.friendships where status = 'accepted' and user_low = least(caller, p_user_id) and user_high = greatest(caller, p_user_id)) then raise exception 'Friend relationship required' using errcode = '42501'; end if;
  select name into ws_name from public.workspaces where id = p_workspace_id;
  insert into public.workspace_invitations(workspace_id, workspace_name, invited_by, invitee_id, invitee_email)
  values (p_workspace_id, ws_name, caller, p_user_id, '');
end;
$$;

revoke all on function public.send_workspace_invitation_to_user(uuid, uuid) from public, anon;
grant execute on function public.send_workspace_invitation_to_user(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
