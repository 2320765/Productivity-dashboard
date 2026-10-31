-- Keep already-deployed clients using admin_audit_events(p_limit) working.
-- The filtered endpoint has a distinct name, avoiding PostgREST overload ambiguity.
alter function public.admin_audit_events(integer,integer,timestamptz,timestamptz,text,text,text)
 rename to admin_audit_search;
create function public.admin_audit_events(p_limit integer default 20)
returns jsonb language sql stable security invoker set search_path = pg_catalog, pg_temp as $$
 select public.admin_audit_search(p_limit) -> 'events';
$$;
revoke all on function public.admin_audit_events(integer) from public,anon;
grant execute on function public.admin_audit_events(integer) to authenticated;
notify pgrst, 'reload schema';
