create table if not exists public.goals (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text not null,
  period text not null check (period in ('year', 'month', 'week', 'day')),
  start_date date not null,
  end_date date not null,
  parent_id text,
  priority text not null check (priority in ('Низкий', 'Средний', 'Высокий')),
  notes text not null default '',
  primary key (user_id, id),
  check (end_date >= start_date),
  foreign key (user_id, parent_id)
    references public.goals (user_id, id)
    deferrable initially deferred
);

create table if not exists public.tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text not null,
  category text not null,
  task_date date not null,
  time text not null default '',
  deadline text not null default '',
  priority text not null check (priority in ('Низкий', 'Средний', 'Высокий')),
  status text not null check (status in ('К выполнению', 'В процессе', 'Выполнено')),
  notes text not null default '',
  goal_id text,
  primary key (user_id, id),
  foreign key (user_id, goal_id)
    references public.goals (user_id, id)
    deferrable initially deferred
);

create table if not exists public.dashboard_revisions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0)
);

create index if not exists goals_owner_dates_idx
  on public.goals (user_id, start_date, end_date);
create index if not exists tasks_owner_date_idx
  on public.tasks (user_id, task_date);

alter table public.goals enable row level security;
alter table public.tasks enable row level security;
alter table public.dashboard_revisions enable row level security;

drop policy if exists "Users manage their own goals" on public.goals;
create policy "Users manage their own goals"
  on public.goals for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own tasks" on public.tasks;
create policy "Users manage their own tasks"
  on public.tasks for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own dashboard revision" on public.dashboard_revisions;
create policy "Users manage their own dashboard revision"
  on public.dashboard_revisions for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.goals, public.tasks, public.dashboard_revisions from anon, public;
grant select, insert, update, delete on public.goals, public.tasks, public.dashboard_revisions to authenticated;

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
    priority, status, notes, goal_id
  )
  select owner_id, item.id, item.title, item.category, item.task_date,
         coalesce(item.time, ''), coalesce(item.deadline, ''),
         item.priority, item.status, coalesce(item.notes, ''), item.goal_id
  from jsonb_to_recordset(p_tasks) as item(
    id text, title text, category text, task_date date, time text, deadline text,
    priority text, status text, notes text, goal_id text
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

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'dashboard_revisions'
    )
  then
    alter publication supabase_realtime add table public.dashboard_revisions;
  end if;
end;
$$;
