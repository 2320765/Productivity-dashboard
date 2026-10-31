-- Агрегированный обзор для единственного администратора.
-- Функция не принимает user_id: права определяются по auth.uid() из JWT через private.is_admin().
-- Возвращаются только счётчики и типы событий с временем: без email, имён, названий и содержимого записей.
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'goals', (select count(*) from public.goals) + (select count(*) from public.workspace_goals),
    'tasks', (select count(*) from public.tasks) + (select count(*) from public.workspace_tasks),
    'workspaces', (select count(*) from public.workspaces),
    'users_last_7_days', (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'workspaces_last_7_days', (select count(*) from public.workspaces where created_at >= now() - interval '7 days'),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('kind', event.kind, 'at', event.at) order by event.at desc)
      from (
        select 'user_signup' as kind, created_at as at from auth.users
        union all
        select 'workspace_created', created_at from public.workspaces
        order by at desc
        limit 15
      ) as event
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

notify pgrst, 'reload schema';
