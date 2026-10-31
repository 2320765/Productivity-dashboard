-- Диагностический поиск целей и задач для администратора. Только чтение.
-- Поиск по точному username, UUID пользователя или идентификатору записи.
-- Возвращаются минимальные сведения (владелец, тип, название, дата, статус, область);
-- заметки, комментарии и email не возвращаются. Каждый поиск требует причину и пишется в журнал.

alter table private.admin_audit_log drop constraint if exists admin_audit_log_action_check;
alter table private.admin_audit_log
  add constraint admin_audit_log_action_check
  check (action in ('block_user', 'unblock_user', 'cancel_invitation', 'restore_owner', 'search_records'));

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

  insert into private.admin_audit_log (admin_id, action, target_user_id, reason)
  values (caller, 'search_records', target, left('Поиск «' || q || '»: ' || clean_reason, 200));

  return result;
end;
$$;

revoke all on function public.admin_find_records(text, text) from public, anon;
grant execute on function public.admin_find_records(text, text) to authenticated;
