create table if not exists public.workspace_record_history (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  record_type text not null check (record_type in ('goal', 'task')),
  record_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('created', 'updated', 'deleted')),
  changes jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp()
);
create index if not exists workspace_record_history_lookup_idx
  on public.workspace_record_history(workspace_id, record_type, record_id, occurred_at desc);
alter table public.workspace_goals add column if not exists archived_at timestamptz;
alter table public.workspace_tasks add column if not exists archived_at timestamptz;
alter table public.workspace_record_history enable row level security;
revoke all on public.workspace_record_history from anon, public, authenticated;

create or replace function public.capture_workspace_record_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  event_changes jsonb := '{}'::jsonb;
  entity_id uuid;
  entity_workspace uuid;
  entity_kind text := case when tg_table_name = 'workspace_tasks' then 'task' else 'goal' end;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.workspaces where id = old.workspace_id) then
    return old;
  end if;
  if auth.uid() is null or not public.is_workspace_member(case when tg_op = 'DELETE' then old.workspace_id else new.workspace_id end) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'INSERT' then
    entity_id := new.id; entity_workspace := new.workspace_id;
    event_changes := jsonb_build_object('title', jsonb_build_object('to', new.title), 'priority', jsonb_build_object('to', new.priority));
    if entity_kind = 'task' then
      event_changes := event_changes || jsonb_build_object('deadline', jsonb_build_object('to', new.deadline), 'status', jsonb_build_object('to', new.status), 'assignee', jsonb_build_object('to', new.assignee_id));
    else
      event_changes := event_changes || jsonb_build_object('deadline', jsonb_build_object('to', new.end_date), 'start_date', jsonb_build_object('to', new.start_date));
    end if;
    insert into public.workspace_record_history(workspace_id, record_type, record_id, actor_id, action, changes)
    values (entity_workspace, entity_kind, entity_id, auth.uid(), 'created', event_changes);
    return new;
  elsif tg_op = 'DELETE' then
    entity_id := old.id; entity_workspace := old.workspace_id;
    insert into public.workspace_record_history(workspace_id, record_type, record_id, actor_id, action, changes)
    values (entity_workspace, entity_kind, entity_id, auth.uid(), 'deleted', '{}'::jsonb);
    return old;
  end if;

  entity_id := new.id; entity_workspace := new.workspace_id;
  if old.title is distinct from new.title then event_changes := event_changes || jsonb_build_object('title', jsonb_build_object('from', old.title, 'to', new.title)); end if;
  if old.priority is distinct from new.priority then event_changes := event_changes || jsonb_build_object('priority', jsonb_build_object('from', old.priority, 'to', new.priority)); end if;
  if entity_kind = 'task' then
    if old.deadline is distinct from new.deadline then event_changes := event_changes || jsonb_build_object('deadline', jsonb_build_object('from', old.deadline, 'to', new.deadline)); end if;
    if old.status is distinct from new.status then event_changes := event_changes || jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)); end if;
    if old.assignee_id is distinct from new.assignee_id then event_changes := event_changes || jsonb_build_object('assignee', jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id)); end if;
  else
    if old.end_date is distinct from new.end_date then event_changes := event_changes || jsonb_build_object('deadline', jsonb_build_object('from', old.end_date, 'to', new.end_date)); end if;
    if old.start_date is distinct from new.start_date then event_changes := event_changes || jsonb_build_object('start_date', jsonb_build_object('from', old.start_date, 'to', new.start_date)); end if;
  end if;
  if old.archived_at is distinct from new.archived_at then
    event_changes := event_changes || jsonb_build_object('archived', jsonb_build_object('from', old.archived_at is not null, 'to', new.archived_at is not null));
  end if;
  if event_changes <> '{}'::jsonb then
    insert into public.workspace_record_history(workspace_id, record_type, record_id, actor_id, action, changes)
    values (entity_workspace, entity_kind, entity_id, auth.uid(), 'updated', event_changes);
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_goals_history on public.workspace_goals;
create trigger workspace_goals_history after insert or update on public.workspace_goals
  for each row execute function public.capture_workspace_record_history();
drop trigger if exists workspace_goals_history_delete on public.workspace_goals;
create trigger workspace_goals_history_delete before delete on public.workspace_goals
  for each row execute function public.capture_workspace_record_history();
drop trigger if exists workspace_tasks_history on public.workspace_tasks;
create trigger workspace_tasks_history after insert or update on public.workspace_tasks
  for each row execute function public.capture_workspace_record_history();
drop trigger if exists workspace_tasks_history_delete on public.workspace_tasks;
create trigger workspace_tasks_history_delete before delete on public.workspace_tasks
  for each row execute function public.capture_workspace_record_history();
revoke all on function public.capture_workspace_record_history() from public, anon, authenticated;

create policy "Current workspace members can read record history" on public.workspace_record_history
  for select to authenticated using (public.is_workspace_member(workspace_id));

create or replace function public.workspace_record_history_for_record(p_workspace_id uuid, p_record_type text, p_record_id uuid)
returns table(id bigint, record_type text, record_id uuid, actor_id uuid, actor_name text,
              action text, changes jsonb, occurred_at timestamptz)
language plpgsql stable security definer set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;
  if p_record_type not in ('goal', 'task') then raise exception 'Invalid record type' using errcode = '22023'; end if;
  if (p_record_type = 'task' and not exists (select 1 from public.workspace_tasks where workspace_id = p_workspace_id and id = p_record_id))
    or (p_record_type = 'goal' and not exists (select 1 from public.workspace_goals where workspace_id = p_workspace_id and id = p_record_id)) then
    raise exception 'Record is unavailable' using errcode = 'P0002';
  end if;
  return query
  select history.id, history.record_type, history.record_id, history.actor_id,
    coalesce(nullif(actor.raw_user_meta_data ->> 'full_name', ''), nullif(actor.raw_user_meta_data ->> 'name', ''), 'Участник'),
    history.action, history.changes, history.occurred_at
  from public.workspace_record_history history join auth.users actor on actor.id = history.actor_id
  where history.workspace_id = p_workspace_id and history.record_type = p_record_type and history.record_id = p_record_id
  order by history.occurred_at desc;
end;
$$;
revoke all on function public.workspace_record_history_for_record(uuid, text, uuid) from public, anon;
grant execute on function public.workspace_record_history_for_record(uuid, text, uuid) to authenticated;
