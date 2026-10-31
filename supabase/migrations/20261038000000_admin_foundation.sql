create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists private.admin_config (
  singleton boolean primary key default true check (singleton),
  admin_user_id uuid not null references auth.users(id) on delete restrict
);

alter table private.admin_config enable row level security;
revoke all on private.admin_config from public, anon, authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select auth.uid() is not null
    and auth.uid() = (
      select config.admin_user_id
      from private.admin_config as config
      where config.singleton
    );
$$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select private.is_admin();
$$;

revoke all on function public.is_current_user_admin() from public, anon;
grant execute on function public.is_current_user_admin() to authenticated;

drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin"
  on public.profiles for select to authenticated
  using ((select private.is_admin()));
