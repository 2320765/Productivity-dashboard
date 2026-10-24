create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workspace_name text not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  invitee_email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_goals (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  created_by uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  period text not null check (period in ('year', 'month', 'week', 'day')),
  start_date date not null,
  end_date date not null,
  parent_id uuid,
  priority text not null check (priority in ('Низкий', 'Средний', 'Высокий')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  check (end_date >= start_date),
  foreign key (workspace_id, parent_id)
    references public.workspace_goals(workspace_id, id)
    on delete set null (parent_id)
);

create table if not exists public.workspace_tasks (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  created_by uuid not null,
  assignee_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 200),
  category text not null default 'Работа',
  task_date date not null,
  time text not null default '',
  deadline text not null default '',
  priority text not null check (priority in ('Низкий', 'Средний', 'Высокий')),
  status text not null check (status in ('К выполнению', 'В процессе', 'Выполнено')),
  notes text not null default '',
  goal_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, goal_id)
    references public.workspace_goals(workspace_id, id)
    on delete set null (goal_id),
  foreign key (workspace_id, assignee_id)
    references public.workspace_members(workspace_id, user_id)
    on delete set null (assignee_id)
);

create index if not exists workspace_members_user_idx
  on public.workspace_members(user_id, workspace_id);
create index if not exists workspace_invitations_recipient_idx
  on public.workspace_invitations(invitee_id, status, created_at desc);
create unique index if not exists workspace_invitations_pending_idx
  on public.workspace_invitations(workspace_id, invitee_id)
  where status = 'pending';
create index if not exists workspace_goals_dates_idx
  on public.workspace_goals(workspace_id, start_date, end_date);
create index if not exists workspace_tasks_date_idx
  on public.workspace_tasks(workspace_id, task_date);

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = p_workspace_id
      and member.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = p_workspace_id
      and member.user_id = (select auth.uid())
      and member.role = 'owner'
  );
$$;

create or replace function public.workspace_member_labels(p_workspace_id uuid)
returns table(user_id uuid, role text, display_name text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;

  return query
  select member.user_id,
         member.role,
         case
           when member.user_id = auth.uid() then 'Вы'
           else coalesce(
             nullif(member_user.raw_user_meta_data ->> 'full_name', ''),
             nullif(member_user.raw_user_meta_data ->> 'name', ''),
             'Участник ' || left(member.user_id::text, 8)
           )
         end
  from public.workspace_members member
  join auth.users member_user on member_user.id = member.user_id
  where member.workspace_id = p_workspace_id
  order by member.role, member.created_at;
end;
$$;

create or replace function public.create_workspace(p_name text, p_description text default '')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  workspace_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 80
    or char_length(coalesce(p_description, '')) > 500 then
    raise exception 'Workspace name or description is invalid' using errcode = '22023';
  end if;

  insert into public.workspaces(name, description, owner_id)
  values (trim(p_name), coalesce(p_description, ''), caller_id)
  returning id into workspace_id;

  insert into public.workspace_members(workspace_id, user_id, role)
  values (workspace_id, caller_id, 'owner');

  return workspace_id;
end;
$$;

create or replace function public.send_workspace_invitation(p_workspace_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  target_id uuid;
  target_email text;
  workspace_label text;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.is_workspace_owner(p_workspace_id) then
    raise exception 'Only the workspace owner can invite members' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_email, ''))) not between 3 and 320
    or position('@' in p_email) < 2 then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;

  select name into workspace_label
  from public.workspaces
  where id = p_workspace_id;

  select id, email into target_id, target_email
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;

  if target_id is null or target_id = caller_id
    or exists (
      select 1 from public.workspace_members member
      where member.workspace_id = p_workspace_id and member.user_id = target_id
    ) then
    return;
  end if;

  insert into public.workspace_invitations(workspace_id, workspace_name, invited_by, invitee_id, invitee_email)
  values (p_workspace_id, workspace_label, caller_id, target_id, target_email)
  on conflict (workspace_id, invitee_id) where status = 'pending' do nothing;
end;
$$;

create or replace function public.respond_to_workspace_invitation(p_invitation_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  invitation public.workspace_invitations%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into invitation
  from public.workspace_invitations
  where id = p_invitation_id and invitee_id = caller_id
  for update;

  if not found or invitation.status <> 'pending' then
    raise exception 'Invitation is no longer pending' using errcode = 'P0002';
  end if;

  update public.workspace_invitations
  set status = case when p_accept then 'accepted' else 'declined' end,
      updated_at = now()
  where id = invitation.id;

  if p_accept then
    insert into public.workspace_members(workspace_id, user_id, role)
    values (invitation.workspace_id, caller_id, 'member')
    on conflict (workspace_id, user_id) do nothing;
  end if;
end;
$$;

create or replace function public.cancel_workspace_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  update public.workspace_invitations
  set status = 'cancelled', updated_at = now()
  where id = p_invitation_id
    and invited_by = auth.uid()
    and status = 'pending'
    and public.is_workspace_owner(workspace_id);
  if not found then
    raise exception 'Invitation cannot be cancelled' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.remove_workspace_member(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.is_workspace_owner(p_workspace_id) or p_user_id = auth.uid() then
    raise exception 'Only the owner can remove another member' using errcode = '42501';
  end if;
  delete from public.workspace_members
  where workspace_id = p_workspace_id and user_id = p_user_id and role = 'member';
  if not found then
    raise exception 'Workspace member not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.leave_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  delete from public.workspace_members
  where workspace_id = p_workspace_id and user_id = auth.uid() and role = 'member';
  if not found then
    raise exception 'Owners must delete their workspace instead of leaving it' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.delete_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  delete from public.workspaces
  where id = p_workspace_id and owner_id = auth.uid()
    and public.is_workspace_owner(id);
  if not found then
    raise exception 'Only the owner can delete this workspace' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.protect_workspace_record_creator()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is distinct from auth.uid() then
      raise exception 'Record creator must be the authenticated user' using errcode = '42501';
    end if;
  elsif new.created_by is distinct from old.created_by
    or new.workspace_id is distinct from old.workspace_id then
    raise exception 'Record creator and workspace cannot be changed' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workspace_goals_creator_guard on public.workspace_goals;
create trigger workspace_goals_creator_guard
  before insert or update on public.workspace_goals
  for each row execute function public.protect_workspace_record_creator();
drop trigger if exists workspace_tasks_creator_guard on public.workspace_tasks;
create trigger workspace_tasks_creator_guard
  before insert or update on public.workspace_tasks
  for each row execute function public.protect_workspace_record_creator();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.workspace_goals enable row level security;
alter table public.workspace_tasks enable row level security;

drop policy if exists "Workspace members can view their workspaces" on public.workspaces;
create policy "Workspace members can view their workspaces"
  on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));

drop policy if exists "Workspace members can view membership" on public.workspace_members;
create policy "Workspace members can view membership"
  on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "Invitation sender and recipient can view invitations" on public.workspace_invitations;
create policy "Invitation sender and recipient can view invitations"
  on public.workspace_invitations for select to authenticated
  using (invited_by = (select auth.uid()) or invitee_id = (select auth.uid()));

drop policy if exists "Workspace members can view shared goals" on public.workspace_goals;
create policy "Workspace members can view shared goals"
  on public.workspace_goals for select to authenticated
  using (public.is_workspace_member(workspace_id));
drop policy if exists "Workspace members can create shared goals" on public.workspace_goals;
create policy "Workspace members can create shared goals"
  on public.workspace_goals for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and created_by = (select auth.uid()));
drop policy if exists "Workspace members can update shared goals" on public.workspace_goals;
create policy "Workspace members can update shared goals"
  on public.workspace_goals for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
drop policy if exists "Workspace members can delete shared goals" on public.workspace_goals;
create policy "Workspace members can delete shared goals"
  on public.workspace_goals for delete to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "Workspace members can view shared tasks" on public.workspace_tasks;
create policy "Workspace members can view shared tasks"
  on public.workspace_tasks for select to authenticated
  using (public.is_workspace_member(workspace_id));
drop policy if exists "Workspace members can create shared tasks" on public.workspace_tasks;
create policy "Workspace members can create shared tasks"
  on public.workspace_tasks for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and created_by = (select auth.uid()));
drop policy if exists "Workspace members can update shared tasks" on public.workspace_tasks;
create policy "Workspace members can update shared tasks"
  on public.workspace_tasks for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
drop policy if exists "Workspace members can delete shared tasks" on public.workspace_tasks;
create policy "Workspace members can delete shared tasks"
  on public.workspace_tasks for delete to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.workspaces, public.workspace_members, public.workspace_invitations,
  public.workspace_goals, public.workspace_tasks from anon, public;
grant select on public.workspaces, public.workspace_members, public.workspace_invitations to authenticated;
grant select, insert, update, delete on public.workspace_goals, public.workspace_tasks to authenticated;

revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_workspace_owner(uuid) from public, anon;
revoke all on function public.workspace_member_labels(uuid) from public, anon;
revoke all on function public.create_workspace(text, text) from public, anon;
revoke all on function public.send_workspace_invitation(uuid, text) from public, anon;
revoke all on function public.respond_to_workspace_invitation(uuid, boolean) from public, anon;
revoke all on function public.cancel_workspace_invitation(uuid) from public, anon;
revoke all on function public.remove_workspace_member(uuid, uuid) from public, anon;
revoke all on function public.leave_workspace(uuid) from public, anon;
revoke all on function public.delete_workspace(uuid) from public, anon;
revoke all on function public.protect_workspace_record_creator() from public, anon, authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
grant execute on function public.workspace_member_labels(uuid) to authenticated;
grant execute on function public.create_workspace(text, text) to authenticated;
grant execute on function public.send_workspace_invitation(uuid, text) to authenticated;
grant execute on function public.respond_to_workspace_invitation(uuid, boolean) to authenticated;
grant execute on function public.cancel_workspace_invitation(uuid) to authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid) to authenticated;
grant execute on function public.leave_workspace(uuid) to authenticated;
grant execute on function public.delete_workspace(uuid) to authenticated;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'workspaces',
      'workspace_members',
      'workspace_invitations',
      'workspace_goals',
      'workspace_tasks'
    ]
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;
