-- Administrative audit: append-only, private, fail-closed and transactional.
alter table private.admin_audit_log drop constraint admin_audit_log_action_check;
alter table private.admin_audit_log add column object_type text;
alter table private.admin_audit_log add column object_id text;
alter table private.admin_audit_log add column operation text;
-- Historical entries retain their original timestamp/actor; unavailable object IDs stay null.
update private.admin_audit_log set object_type = case
 when action in ('block_user','unblock_user') then 'user'
 when action = 'cancel_invitation' then 'workspace_invitations'
 when action = 'restore_owner' then 'workspaces' else 'record_search' end,
 object_id = case when action in ('block_user','unblock_user') then target_user_id::text
 when action = 'restore_owner' then workspace_id::text end;
-- Stop retaining workspace names and raw search queries in new events.
alter table private.admin_audit_log alter column object_type set not null;
alter table private.admin_audit_log add constraint admin_audit_log_action_check check
 (action in ('block_user','unblock_user','cancel_invitation','restore_owner','search_records',
 'add_member','remove_member','change_member','change_owner','correct_record'));
create index admin_audit_action_date_idx on private.admin_audit_log(action, created_at desc, id desc);
create index admin_audit_object_date_idx on private.admin_audit_log(object_type, object_id, created_at desc, id desc);
alter table private.admin_audit_log enable row level security;
revoke all on private.admin_audit_log from public, anon, authenticated, service_role;
revoke all on sequence private.admin_audit_log_id_seq from public, anon, authenticated, service_role;
grant select on private.admin_audit_log to authenticated;
create policy admin_audit_read on private.admin_audit_log for select to authenticated
 using ((select private.is_admin()) and not (select private.is_blocked()));

create or replace function private.audit_reason(p_reason text)
returns text language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
begin
 if char_length(trim(coalesce(p_reason,''))) not between 3 and 200 then
   raise exception 'Reason is required (3-200 characters)' using errcode='22023';
 end if;
 -- Reject common credentials rather than retaining them. Never serialize changed row values.
 if p_reason ~* '(password|пароль|token|токен|secret|секрет|bearer|api[_ -]?key|eyJ[A-Za-z0-9_-]+[.]|sb_secret_|sk-[A-Za-z0-9]|[A-Za-z0-9_+/=-]{32,})' then
   raise exception 'Do not include credentials or secrets in the reason' using errcode='22023';
 end if;
 return trim(p_reason);
end; $$;
revoke all on function private.audit_reason(text) from public, anon, authenticated;

create or replace function private.guard_admin_audit()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
 if tg_op <> 'INSERT' then
   raise exception 'Administrative audit is immutable' using errcode='42501';
 end if;
 if not private.is_admin() or private.is_blocked() then
   raise exception 'Administrator permission required' using errcode='42501';
 end if;
 new.admin_id := auth.uid();
 new.created_at := clock_timestamp();
 new.workspace_name := null;
 new.reason := private.audit_reason(new.reason);
 return new;
end; $$;
revoke all on function private.guard_admin_audit() from public, anon, authenticated;
create trigger admin_audit_insert_guard before insert on private.admin_audit_log
 for each row execute function private.guard_admin_audit();
create trigger admin_audit_immutable before update or delete on private.admin_audit_log
 for each row execute function private.guard_admin_audit();
create trigger admin_audit_no_truncate before truncate on private.admin_audit_log
 for each statement execute function private.guard_admin_audit();

create or replace function private.capture_admin_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
 row_data jsonb;
 event_action text := 'correct_record';
 target_id text;
 target_user uuid;
 ws uuid;
 why text;
begin
 -- The admin identity comes from verified Auth claims + private.admin_config, never metadata or payload.
 if not private.is_admin() then return null; end if;
 if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then return null; end if;
 row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
 why := coalesce(nullif(current_setting('app.admin_audit_reason', true),''), 'Изменение администратором');
 if tg_table_schema = 'auth' then
   if (old.banned_until is not null and old.banned_until > now()) =
      (new.banned_until is not null and new.banned_until > now()) then return null; end if;
   event_action := case when new.banned_until > now() then 'block_user' else 'unblock_user' end;
   target_id := new.id::text; target_user := new.id;
 elsif tg_table_name = 'workspace_members' then
   event_action := case tg_op when 'INSERT' then 'add_member' when 'DELETE' then 'remove_member' else 'change_member' end;
   target_user := (row_data->>'user_id')::uuid;
   ws := (row_data->>'workspace_id')::uuid;
   target_id := ws::text || '/' || target_user::text;
 elsif tg_table_name = 'workspaces' then
   ws := (row_data->>'id')::uuid; target_id := ws::text;
   target_user := (row_data->>'owner_id')::uuid;
   if tg_op = 'UPDATE' and old.owner_id is distinct from new.owner_id then event_action := 'change_owner'; end if;
 elsif tg_table_name = 'workspace_invitations' then
   target_id := row_data->>'id'; ws := (row_data->>'workspace_id')::uuid;
   target_user := (row_data->>'invitee_id')::uuid;
   if tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'cancelled' then
     event_action := 'cancel_invitation';
   end if;
 else
   target_user := coalesce(row_data->>'user_id',row_data->>'created_by',row_data->>'author_id')::uuid;
   ws := (row_data->>'workspace_id')::uuid;
   target_id := coalesce(row_data->>'id',row_data->>'user_id');
 end if;
 insert into private.admin_audit_log(admin_id,action,target_user_id,workspace_id,object_type,object_id,operation,reason)
 values(auth.uid(),event_action,target_user,ws,
   case when tg_table_schema='auth' then 'user' else tg_table_name end,target_id,tg_op,why);
 return null;
end; $$;
revoke all on function private.capture_admin_change() from public, anon, authenticated;
create trigger admin_audit_user_block after update of banned_until on auth.users
 for each row execute function private.capture_admin_change();
do $$ declare tbl text; begin
 foreach tbl in array array['workspace_members','workspaces','workspace_invitations','goals','tasks',
 'workspace_goals','workspace_tasks','workspace_task_comments','profiles'] loop
 execute format('create trigger admin_audit_change after insert or update or delete on public.%I for each row execute function private.capture_admin_change()',tbl);
 end loop;
end; $$;

create or replace function public.admin_set_user_blocked(p_user_id uuid, p_blocked boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  perform set_config('app.admin_audit_reason', private.audit_reason(p_reason), true);
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

  perform set_config('app.admin_audit_reason', '', true);
end;
$$;

create or replace function public.admin_restore_workspace_owner(p_workspace_id uuid, p_user_id uuid, p_confirm boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  caller uuid := auth.uid();
  ws_name text;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  perform set_config('app.admin_audit_reason', private.audit_reason(p_reason), true);
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

  perform set_config('app.admin_audit_reason', '', true);
end;
$$;

create or replace function public.admin_cancel_workspace_invitation(p_invitation_id uuid, p_confirm boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := left(trim(coalesce(p_reason, '')), 200);
  inv record;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  perform set_config('app.admin_audit_reason', private.audit_reason(p_reason), true);
  if p_confirm is distinct from true then
    raise exception 'Confirmation required' using errcode = '22023';
  end if;
  if char_length(clean_reason) < 3 then
    raise exception 'Reason is required (3-200 characters)' using errcode = '22023';
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

  perform set_config('app.admin_audit_reason', '', true);
end;
$$;

create or replace function public.admin_find_records(p_query text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  caller uuid := auth.uid();
  q text := trim(coalesce(p_query, ''));
  clean_reason text := trim(coalesce(p_reason, ''));
  q_uuid uuid;
  target uuid;
  result jsonb;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if char_length(q) not between 3 and 64 then
    raise exception 'Query must be 3-64 characters' using errcode = '22023';
  end if;
  if char_length(clean_reason) not between 3 and 200 then
    raise exception 'Reason is required (3-200 characters)' using errcode = '22023';
  end if;

  if q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    q_uuid := q::uuid;
  end if;
  if q_uuid is not null and exists (select 1 from auth.users where id = q_uuid) then
    target := q_uuid;
  else
    select user_id into target from public.profiles where lower(username) = lower(ltrim(q, '@'));
  end if;

  with found as (
    select 'goal'::text as kind, 'personal'::text as scope, g.user_id as owner_id, null::uuid as workspace_id,
           g.id as record_id, g.title, g.start_date as record_date, null::text as status, g.archived_at is not null as archived
      from public.goals g
     where g.user_id = target or g.id = q
    union all
    select 'task', 'personal', t.user_id, null, t.id, t.title, t.task_date, t.status, t.archived_at is not null
      from public.tasks t
     where t.user_id = target or t.id = q
    union all
    select 'goal', 'workspace', g.created_by, g.workspace_id, g.id::text, g.title, g.start_date, null, g.archived_at is not null
      from public.workspace_goals g
     where g.created_by = target or g.id = q_uuid
    union all
    select 'task', 'workspace', t.created_by, t.workspace_id, t.id::text, t.title, t.task_date, t.status, t.archived_at is not null
      from public.workspace_tasks t
     where t.created_by = target or t.id = q_uuid
  ), page as (
    select * from found order by record_date desc nulls last, record_id limit 50
  )
  select jsonb_build_object(
    'total', (select count(*) from found),
    'user_found', target is not null,
    'records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', page.kind,
        'scope', page.scope,
        'owner_id', page.owner_id,
        'owner', private.person_label(page.owner_id),
        'workspace', (select w.name from public.workspaces w where w.id = page.workspace_id),
        'record_id', page.record_id,
        'title', left(page.title, 200),
        'date', page.record_date,
        'status', page.status,
        'archived', page.archived
      ) order by page.record_date desc nulls last, page.record_id)
      from page
    ), '[]'::jsonb)
  ) into result;

  insert into private.admin_audit_log (admin_id, action, target_user_id, reason, object_type, object_id)
  values (caller, 'search_records', target, private.audit_reason(clean_reason), 'record_search', target::text);

  return result;
end;
$$;

-- Replace the old signature, avoiding ambiguous PostgREST overloads.
drop function public.admin_audit_events(integer);
create function public.admin_audit_events(p_limit integer default 20, p_offset integer default 0,
 p_from timestamptz default null, p_to timestamptz default null, p_action text default null,
 p_object_type text default null, p_object_id text default null)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare result jsonb; begin
 if auth.uid() is null or not private.is_admin() or private.is_blocked() then
   raise exception 'Administrator permission required' using errcode='42501';
 end if;
 if p_from is not null and p_to is not null and p_from >= p_to then
   raise exception 'Invalid date interval' using errcode='22023';
 end if;
 with matched as (
 select * from private.admin_audit_log e
 where (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)
 and (nullif(p_action,'') is null or e.action=p_action)
 and (nullif(p_object_type,'') is null or e.object_type=p_object_type)
 and (nullif(p_object_id,'') is null or e.object_id=p_object_id or e.workspace_id::text=p_object_id or e.target_user_id::text=p_object_id)
 ), page as (
 select * from matched order by created_at desc,id desc
 limit least(greatest(coalesce(p_limit,20),1),100) offset greatest(coalesce(p_offset,0),0)
 ) select jsonb_build_object('total',(select count(*) from matched),'events',coalesce((
 select jsonb_agg(jsonb_build_object('id',id::text,'action',action,'admin_id',admin_id,
 'target_user_id',target_user_id,'workspace_id',workspace_id,'object_type',object_type,
 'object_id',object_id,'operation',operation,'reason',reason,'created_at',created_at)
 order by created_at desc,id desc) from page),'[]'::jsonb)) into result;
 return result;
end; $$;
revoke all on function public.admin_audit_events(integer,integer,timestamptz,timestamptz,text,text,text) from public,anon;
grant execute on function public.admin_audit_events(integer,integer,timestamptz,timestamptz,text,text,text) to authenticated;
notify pgrst, 'reload schema';
