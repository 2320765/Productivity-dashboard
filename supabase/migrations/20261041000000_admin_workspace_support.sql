-- Поддержка рабочих пространств для единственного администратора.
-- Только метаданные и счётчики: названия/содержимое целей и задач не возвращаются.
-- Изменяющие действия (отмена приглашения, восстановление владельца) требуют явного
-- подтверждения на сервере и пишутся в private.admin_audit_log. service_role не используется.

alter table private.admin_audit_log drop constraint if exists admin_audit_log_action_check;
alter table private.admin_audit_log
  add constraint admin_audit_log_action_check
  check (action in ('block_user', 'unblock_user', 'cancel_invitation', 'restore_owner'));
alter table private.admin_audit_log alter column target_user_id drop not null;
alter table private.admin_audit_log add column if not exists workspace_id uuid;
alter table private.admin_audit_log add column if not exists workspace_name text;

create or replace function private.person_label(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select '@' || prof.username from public.profiles prof where prof.user_id = p_user_id),
    (select coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), nullif(u.raw_user_meta_data ->> 'name', ''))
       from auth.users u where u.id = p_user_id),
    'Без имени'
  );
$$;
revoke all on function private.person_label(uuid) from public, anon, authenticated;

create or replace function public.admin_list_workspaces(p_search text default '', p_limit integer default 20, p_offset integer default 0)
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
    select w.id, w.name, w.owner_id, w.created_at
    from public.workspaces w
    where q = ''
      or w.id::text = q
      or lower(w.name) like pattern escape '\'
      or lower(coalesce(private.person_label(w.owner_id), '')) like pattern escape '\'
  ), page as (
    select * from matched order by created_at desc, id limit lim offset off
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'workspaces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id,
        'name', page.name,
        'created_at', page.created_at,
        'owner', private.person_label(page.owner_id),
        'owner_ok', exists (select 1 from public.workspace_members m where m.workspace_id = page.id and m.user_id = page.owner_id and m.role = 'owner'),
        'members', (select count(*) from public.workspace_members m where m.workspace_id = page.id),
        'goals', (select count(*) from public.workspace_goals g where g.workspace_id = page.id),
        'tasks', (select count(*) from public.workspace_tasks t where t.workspace_id = page.id),
        'pending_invitations', (select count(*) from public.workspace_invitations i where i.workspace_id = page.id and i.status = 'pending')
      ) order by page.created_at desc, page.id)
      from page
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_list_workspaces(text, integer, integer) from public, anon;
grant execute on function public.admin_list_workspaces(text, integer, integer) to authenticated;

-- Состав и приглашения одного пространства. Email приглашённых не возвращается.
create or replace function public.admin_workspace_details(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  ws record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;

  select id, name, owner_id into ws from public.workspaces where id = p_workspace_id;
  if not found then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', ws.id,
    'name', ws.name,
    'owner_id', ws.owner_id,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'label', private.person_label(m.user_id),
        'role', m.role,
        'joined_at', m.created_at,
        'blocked', exists (select 1 from auth.users u where u.id = m.user_id and u.banned_until is not null and u.banned_until > now())
      ) order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at)
      from public.workspace_members m where m.workspace_id = ws.id
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'invitee', case when i.invitee_id is null then 'Не определён' else private.person_label(i.invitee_id) end,
        'invited_by', case when i.invited_by is null then null else private.person_label(i.invited_by) end,
        'status', i.status,
        'created_at', i.created_at
      ) order by (i.status = 'pending') desc, i.created_at desc)
      from (
        select * from public.workspace_invitations
        where workspace_id = ws.id order by (status = 'pending') desc, created_at desc limit 50
      ) i
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_workspace_details(uuid) from public, anon;
grant execute on function public.admin_workspace_details(uuid) to authenticated;

-- Отмена зависшего приглашения (только pending). Требует p_confirm = true.
create or replace function public.admin_cancel_workspace_invitation(p_invitation_id uuid, p_confirm boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := nullif(left(trim(coalesce(p_reason, '')), 200), '');
  inv record;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_confirm is distinct from true then
    raise exception 'Confirmation required' using errcode = '22023';
  end if;

  select i.id, i.workspace_id, i.invitee_id, w.name
    into inv
    from public.workspace_invitations i
    left join public.workspaces w on w.id = i.workspace_id
   where i.id = p_invitation_id and i.status = 'pending'
   for update of i;
  if not found then
    raise exception 'Pending invitation not found' using errcode = 'P0002';
  end if;

  update public.workspace_invitations set status = 'cancelled', updated_at = now() where id = inv.id;

  insert into private.admin_audit_log (admin_id, action, target_user_id, reason, workspace_id, workspace_name)
  values (caller, 'cancel_invitation', inv.invitee_id, clean_reason, inv.workspace_id, inv.name);
end;
$$;

revoke all on function public.admin_cancel_workspace_invitation(uuid, boolean, text) from public, anon;
grant execute on function public.admin_cancel_workspace_invitation(uuid, boolean, text) to authenticated;

-- Восстановление владельца: новым владельцем может стать только текущий участник.
-- Прежний владелец, если остался участником, получает роль admin. Участников не добавляем и не удаляем.
create or replace function public.admin_restore_workspace_owner(p_workspace_id uuid, p_user_id uuid, p_confirm boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := nullif(left(trim(coalesce(p_reason, '')), 200), '');
  ws_name text;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_confirm is distinct from true then
    raise exception 'Confirmation required' using errcode = '22023';
  end if;
  if p_workspace_id is null or p_user_id is null then
    raise exception 'Workspace and user are required' using errcode = '22023';
  end if;

  select name into ws_name from public.workspaces where id = p_workspace_id for update;
  if not found then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id) then
    raise exception 'New owner must be a current participant' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where id = p_user_id and banned_until is not null and banned_until > now()) then
    raise exception 'Blocked user cannot become owner' using errcode = '22023';
  end if;

  update public.workspace_members set role = 'admin'
   where workspace_id = p_workspace_id and role = 'owner' and user_id <> p_user_id;
  update public.workspace_members set role = 'owner'
   where workspace_id = p_workspace_id and user_id = p_user_id;
  update public.workspaces set owner_id = p_user_id where id = p_workspace_id;

  insert into private.admin_audit_log (admin_id, action, target_user_id, reason, workspace_id, workspace_name)
  values (caller, 'restore_owner', p_user_id, clean_reason, p_workspace_id, ws_name);
end;
$$;

revoke all on function public.admin_restore_workspace_owner(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.admin_restore_workspace_owner(uuid, uuid, boolean, text) to authenticated;

-- Журнал: добавляем данные пространства.
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
      'workspace_name', entry.workspace_name,
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
