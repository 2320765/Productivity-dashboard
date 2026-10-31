-- Blocked accounts must not bypass restrictive RLS through SECURITY DEFINER RPCs.
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select auth.uid() is not null and not private.is_blocked()
 and auth.uid()=(select admin_user_id from private.admin_config where singleton);
$$;
revoke all on private.admin_config from public,anon,authenticated;
-- Preserve each existing function body, arguments, grants and ownership.
-- The first BEGIN is the outer PL/pgSQL block. Fail rather than silently skip a body.
do $migration$
declare fn record; definition text; patched text;
begin
 for fn in
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  join pg_language l on l.oid=p.prolang
  where n.nspname='public' and p.prosecdef and l.lanname='plpgsql'
    and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype)
 loop
  definition:=pg_get_functiondef(fn.oid);
  if position('-- active-account-guard' in definition)>0 then continue; end if;
  patched:=regexp_replace(definition, E'\\mBEGIN\\M',
   E'BEGIN\n -- active-account-guard\n IF private.is_blocked() THEN\n RAISE EXCEPTION \'Account is blocked\' USING ERRCODE=\'42501\';\n END IF;', 'i');
  if patched=definition then raise exception 'Cannot guard function %',fn.oid::regprocedure; end if;
  execute patched;
 end loop;
end $migration$;
-- This history table was added after the original block-list migration.
drop policy if exists "Blocked users have no access" on public.workspace_record_history;
create policy "Blocked users have no access" on public.workspace_record_history
 as restrictive for all to authenticated using (not (select private.is_blocked()))
 with check (not (select private.is_blocked()));
-- Trigger functions are internal implementation, never browser APIs.
revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
revoke execute on function public.create_profile_for_new_auth_user() from public,anon,authenticated;
revoke execute on function public.capture_workspace_record_history() from public,anon,authenticated;
notify pgrst,'reload schema';
