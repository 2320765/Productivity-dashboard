-- Напоминания хранятся вместе с личной задачей; существующим задачам назначается «без напоминания».
alter table public.tasks add column if not exists reminder jsonb;

alter table public.tasks drop constraint if exists tasks_reminder_valid;
alter table public.tasks add constraint tasks_reminder_valid check (
  reminder is null or (
    jsonb_typeof(reminder) = 'object'
    and coalesce(reminder ->> 'mode' in ('none', 'at', 'before'), false)
    and (
      reminder ->> 'mode' <> 'before'
      or reminder ->> 'minutes' in ('5', '15', '30', '60', '1440')
    )
  )
);

-- RLS таблицы tasks уже ограничивает доступ владельцем (user_id = auth.uid()); новая колонка наследует те же политики.
create or replace function public.sync_dashboard(
  p_goals jsonb,
  p_tasks jsonb,
  p_expected_revision bigint
)
returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_revision bigint;
  next_revision bigint;
  owner_id uuid := auth.uid();
begin
  if owner_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if jsonb_typeof(p_goals) is distinct from 'array'
    or jsonb_typeof(p_tasks) is distinct from 'array' then
    raise exception 'Goals and tasks must be JSON arrays' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));

  select revision into current_revision
  from public.dashboard_revisions
  where user_id = owner_id
  for update;
  current_revision := coalesce(current_revision, 0);

  if current_revision <> p_expected_revision then
    raise exception 'Dashboard revision conflict' using errcode = '40001';
  end if;

  delete from public.tasks where user_id = owner_id;
  delete from public.goals where user_id = owner_id;

  insert into public.goals (user_id, id, title, period, start_date, end_date, parent_id, priority, notes)
  select owner_id, item.id, item.title, item.period, item.start_date, item.end_date,
         null, item.priority, coalesce(item.notes, '')
  from jsonb_to_recordset(p_goals) as item(
    id text, title text, period text, start_date date, end_date date,
    parent_id text, priority text, notes text
  );

  update public.goals as goal
  set parent_id = item.parent_id
  from jsonb_to_recordset(p_goals) as item(id text, parent_id text)
  where goal.user_id = owner_id
    and goal.id = item.id
    and item.parent_id is not null;

  insert into public.tasks (
    user_id, id, title, category, task_date, time, deadline,
    priority, status, notes, goal_id, recurrence, moved_from, moved_at, move_count, reminder
  )
  select owner_id, item.id, item.title, item.category, item.task_date,
         coalesce(item.time, ''), coalesce(item.deadline, ''),
         item.priority, item.status, coalesce(item.notes, ''), item.goal_id,
         case when jsonb_typeof(item.recurrence) = 'object' then item.recurrence else null end,
         item.moved_from, item.moved_at, coalesce(item.move_count, 0),
         case when jsonb_typeof(item.reminder) = 'object' then item.reminder else null end
  from jsonb_to_recordset(p_tasks) as item(
    id text, title text, category text, task_date date, time text, deadline text,
    priority text, status text, notes text, goal_id text, recurrence jsonb,
    moved_from date, moved_at timestamptz, move_count integer, reminder jsonb
  );

  insert into public.dashboard_revisions (user_id, revision)
  values (owner_id, current_revision + 1)
  on conflict (user_id) do update
    set revision = excluded.revision
  returning revision into next_revision;

  return next_revision;
end;
$$;

revoke all on function public.sync_dashboard(jsonb, jsonb, bigint) from public, anon;
grant execute on function public.sync_dashboard(jsonb, jsonb, bigint) to authenticated;

notify pgrst, 'reload schema';
