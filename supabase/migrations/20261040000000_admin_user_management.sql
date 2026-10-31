-- Управление пользователями для единственного администратора.
-- Блокировка использует штатный механизм Supabase Auth (auth.users.banned_until):
-- заблокированный не может войти и обновить сессию. service_role и ключи не используются.

create table if not exists private.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  action text not null check (action in ('block_user', 'unblock_user')),
  target_user_id uuid not null,
  reason text,
  created_at timestamptz not null default now()
);

alter table private.admin_audit_log enable row level security;
revoke all on private.admin_audit_log from public, anon, authenticated;

create index if not exists admin_audit_log_created_idx on private.admin_audit_log (created_at desc);

-- Заблокирован ли текущий пользователь. Нужна RLS-политикам, чтобы блокировка действовала
-- сразу, а не только после истечения уже выданного access token.
create or replace function private.is_blocked()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from auth.users account
    where account.id = auth.uid()
      and account.banned_until is not null
      and account.banned_until > now()
  );
$$;

revoke all on function private.is_blocked() from public, anon;
grant execute on function private.is_blocked() to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'goals', 'tasks', 'dashboard_revisions', 'profiles', 'friendships',
    'workspaces', 'workspace_members', 'workspace_goals', 'workspace_tasks',
    'workspace_task_comments', 'workspace_invitations'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists "Blocked users have no access" on public.%I', table_name);
      execute format(
        'create policy "Blocked users have no access" on public.%I as restrictive for all to authenticated using (not (select private.is_blocked())) with check (not (select private.is_blocked()))',
        table_name
      );
    end if;
  end loop;
end;
$$;

-- Список и поиск: только безопасные сведения (без email, паролей, токенов и содержимого записей).
create or replace function public.admin_list_users(p_search text default '', p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  q text := lower(trim(coalesce(p_search, '')));
  pattern text;
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  off integer := greatest(coalesce(p_offset, 0), 0);
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if char_length(q) > 64 then
    raise exception 'Search query is too long' using errcode = '22023';
  end if;
  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with matched as (
    select account.id,
           prof.username,
           coalesce(nullif(account.raw_user_meta_data ->> 'full_name', ''), nullif(account.raw_user_meta_data ->> 'name', '')) as display_name,
           account.created_at,
           (account.banned_until is not null and account.banned_until > now()) as blocked
    from auth.users account
    left join public.profiles prof on prof.user_id = account.id
    where account.deleted_at is null
      and (
        q = ''
        or account.id::text = q
        or lower(coalesce(prof.username, '')) like pattern escape '\'
        or lower(coalesce(account.raw_user_meta_data ->> 'full_name', account.raw_user_meta_data ->> 'name', '')) like pattern escape '\'
      )
  ), page as (
    select * from matched order by created_at desc, id limit lim offset off
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id,
        'username', page.username,
        'display_name', page.display_name,
        'created_at', page.created_at,
        'blocked', page.blocked,
        'is_admin', page.id = (select admin_user_id from private.admin_config where singleton),
        'goals', (select count(*) from public.goals g where g.user_id = page.id),
        'tasks', (select count(*) from public.tasks t where t.user_id = page.id),
        'workspaces', (select count(*) from public.workspace_members m where m.user_id = page.id)
      ) order by page.created_at desc, page.id)
      from page
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_list_users(text, integer, integer) from public, anon;
grant execute on function public.admin_list_users(text, integer, integer) to authenticated;

-- Блокировка/разблокировка. Администратора и самого себя заблокировать нельзя.
create or replace function public.admin_set_user_blocked(p_user_id uuid, p_blocked boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := nullif(left(trim(coalesce(p_reason, '')), 200), '');
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_user_id is null or p_blocked is null then
    raise exception 'User and state are required' using errcode = '22023';
  end if;
  if p_user_id = caller then
    raise exception 'Administrator cannot block themselves' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id and deleted_at is null) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  if p_blocked then
    update auth.users set banned_until = now() + interval '100 years' where id = p_user_id;
    -- Закрываем существующие сессии (refresh-токены удаляются каскадом).
    delete from auth.sessions where user_id = p_user_id;
  else
    update auth.users set banned_until = null where id = p_user_id;
  end if;

  insert into private.admin_audit_log (admin_id, action, target_user_id, reason)
  values (caller, case when p_blocked then 'block_user' else 'unblock_user' end, p_user_id, clean_reason);
end;
$$;

revoke all on function public.admin_set_user_blocked(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_user_blocked(uuid, boolean, text) to authenticated;

-- Журнал административных изменений.
create or replace function public.admin_audit_events(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', entry.id,
      'action', entry.action,
      'target_user_id', entry.target_user_id,
      'target_username', prof.username,
      'reason', entry.reason,
      'created_at', entry.created_at
    ) order by entry.created_at desc, entry.id desc)
    from (
      select * from private.admin_audit_log order by created_at desc, id desc limit lim
    ) entry
    left join public.profiles prof on prof.user_id = entry.target_user_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_audit_events(integer) from public, anon;
grant execute on function public.admin_audit_events(integer) to authenticated;

notify pgrst, 'reload schema';
