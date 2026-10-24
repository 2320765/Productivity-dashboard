create table if not exists public.workspace_task_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, task_id)
    references public.workspace_tasks(workspace_id, id) on delete cascade
);

create index if not exists workspace_task_comments_task_idx
  on public.workspace_task_comments(workspace_id, task_id, created_at);

create or replace function public.protect_workspace_task_comment()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.author_id is distinct from auth.uid()
      or not public.is_workspace_member(new.workspace_id) then
      raise exception 'Comment author must be a workspace member' using errcode = '42501';
    end if;
  elsif new.author_id is distinct from old.author_id
    or new.workspace_id is distinct from old.workspace_id
    or new.task_id is distinct from old.task_id then
    raise exception 'Comment author and task cannot be changed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.workspace_tasks task
    where task.workspace_id = new.workspace_id and task.id = new.task_id
  ) then
    raise exception 'Comment must belong to a shared task in the same workspace' using errcode = '23503';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workspace_task_comments_guard on public.workspace_task_comments;
create trigger workspace_task_comments_guard
  before insert or update on public.workspace_task_comments
  for each row execute function public.protect_workspace_task_comment();

alter table public.workspace_task_comments enable row level security;

drop policy if exists "Workspace members can view task comments" on public.workspace_task_comments;
create policy "Workspace members can view task comments"
  on public.workspace_task_comments for select to authenticated
  using (public.is_workspace_member(workspace_id));
drop policy if exists "Workspace members can comment on shared tasks" on public.workspace_task_comments;
create policy "Workspace members can comment on shared tasks"
  on public.workspace_task_comments for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and author_id = (select auth.uid()));
drop policy if exists "Authors can edit their task comments" on public.workspace_task_comments;
create policy "Authors can edit their task comments"
  on public.workspace_task_comments for update to authenticated
  using (public.is_workspace_member(workspace_id) and author_id = (select auth.uid()))
  with check (public.is_workspace_member(workspace_id) and author_id = (select auth.uid()));
drop policy if exists "Authors and owners can delete task comments" on public.workspace_task_comments;
create policy "Authors and owners can delete task comments"
  on public.workspace_task_comments for delete to authenticated
  using (public.is_workspace_member(workspace_id)
    and (author_id = (select auth.uid()) or public.is_workspace_owner(workspace_id)));

revoke all on public.workspace_task_comments from anon, public;
grant select, insert, update, delete on public.workspace_task_comments to authenticated;
revoke all on function public.protect_workspace_task_comment() from public, anon, authenticated;

create or replace function public.workspace_task_comments_with_authors(p_workspace_id uuid)
returns table(id uuid, workspace_id uuid, task_id uuid, author_id uuid, author_name text,
              body text, created_at timestamptz, updated_at timestamptz)
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
  select comment.id, comment.workspace_id, comment.task_id, comment.author_id,
    coalesce(nullif(author.raw_user_meta_data ->> 'full_name', ''),
             nullif(author.raw_user_meta_data ->> 'name', ''),
             case when author.id = auth.uid() then 'Вы' else 'Участник ' || left(author.id::text, 8) end),
    comment.body, comment.created_at, comment.updated_at
  from public.workspace_task_comments comment
  join auth.users author on author.id = comment.author_id
  where comment.workspace_id = p_workspace_id
    and exists (
      select 1 from public.workspace_members author_member
      where author_member.workspace_id = comment.workspace_id
        and author_member.user_id = comment.author_id
    )
  order by comment.created_at;
end;
$$;
revoke all on function public.workspace_task_comments_with_authors(uuid) from public, anon;
grant execute on function public.workspace_task_comments_with_authors(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'workspace_task_comments'
    ) then
    alter publication supabase_realtime add table public.workspace_task_comments;
  end if;
end;
$$;
