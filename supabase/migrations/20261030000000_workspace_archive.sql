alter table public.workspace_goals
  add column if not exists archived_by uuid references auth.users(id) on delete set null;
alter table public.workspace_tasks
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

create or replace function public.guard_workspace_archive_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.archived_at is not null or new.archived_by is not null then
      raise exception 'New shared records cannot be archived on creation' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.archived_at is distinct from old.archived_at
    or new.archived_by is distinct from old.archived_by then
    if auth.uid() is null
      or not public.can_manage_workspace(new.workspace_id)
      or (new.archived_at is null and new.archived_by is not null)
      or (new.archived_at is not null and new.archived_by is distinct from auth.uid()) then
      raise exception 'Only workspace owners and administrators can archive or restore records' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_goals_archive_guard on public.workspace_goals;
create trigger workspace_goals_archive_guard
  before insert or update on public.workspace_goals
  for each row execute function public.guard_workspace_archive_metadata();
drop trigger if exists workspace_tasks_archive_guard on public.workspace_tasks;
create trigger workspace_tasks_archive_guard
  before insert or update on public.workspace_tasks
  for each row execute function public.guard_workspace_archive_metadata();

create or replace function public.set_workspace_record_archived(
  p_workspace_id uuid,
  p_record_type text,
  p_record_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  record_exists boolean;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_record_type is null or p_record_type not in ('goal', 'task') then
    raise exception 'Record type must be goal or task' using errcode = '22023';
  end if;
  if p_archived is null then
    raise exception 'Archive state is required' using errcode = '22023';
  end if;
  if not public.can_manage_workspace(p_workspace_id) then
    raise exception 'Only workspace owners and administrators can archive or restore records' using errcode = '42501';
  end if;

  if p_record_type = 'goal' then
    select exists (
      select 1 from public.workspace_goals
      where workspace_id = p_workspace_id and id = p_record_id
    ) into record_exists;
    if not record_exists then
      raise exception 'Workspace goal not found' using errcode = 'P0002';
    end if;
    update public.workspace_goals
    set archived_at = case when p_archived then clock_timestamp() else null end,
        archived_by = case when p_archived then caller_id else null end,
        updated_at = clock_timestamp()
    where workspace_id = p_workspace_id
      and id = p_record_id
      and (archived_at is not null) is distinct from p_archived;
  else
    select exists (
      select 1 from public.workspace_tasks
      where workspace_id = p_workspace_id and id = p_record_id
    ) into record_exists;
    if not record_exists then
      raise exception 'Workspace task not found' using errcode = 'P0002';
    end if;
    update public.workspace_tasks
    set archived_at = case when p_archived then clock_timestamp() else null end,
        archived_by = case when p_archived then caller_id else null end,
        updated_at = clock_timestamp()
    where workspace_id = p_workspace_id
      and id = p_record_id
      and (archived_at is not null) is distinct from p_archived;
  end if;
end;
$$;

revoke all on function public.guard_workspace_archive_metadata() from public, anon, authenticated;
revoke all on function public.set_workspace_record_archived(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.set_workspace_record_archived(uuid, text, uuid, boolean) to authenticated;
