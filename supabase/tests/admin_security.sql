-- Privileged SQL harness only; no live account or application policy is weakened.
begin;
create temporary table security_context as
 select admin_user_id as admin_id, gen_random_uuid() as user_id, gen_random_uuid() as other_id,
 gen_random_uuid() as workspace_id, gen_random_uuid() as invitation_id
 from private.admin_config where singleton;
do $$ begin
 if (select count(*) from security_context)<>1 then raise exception 'Expected exactly one administrator'; end if;
end $$;
insert into auth.users(id,aud,role,raw_user_meta_data)
 select user_id,'authenticated','authenticated',jsonb_build_object('username','security_'||left(replace(user_id::text,'-',''),10),'is_admin',true) from security_context
 union all select other_id,'authenticated','authenticated',jsonb_build_object('username','security_'||left(replace(other_id::text,'-',''),10)) from security_context;
do $$ begin
 if (select count(*) from public.profiles where user_id in (select user_id from security_context union select other_id from security_context))<>2 then raise exception 'Signup profile trigger failed'; end if;
end $$;
insert into public.tasks(user_id,id,title,category,task_date,priority,status,notes)
 select user_id,'security_own','Own task','test',current_date,'Средний','К выполнению','Private note' from security_context
 union all select other_id,'security_other','Other task','test',current_date,'Средний','К выполнению','Hidden note' from security_context;
insert into public.workspaces(id,name,owner_id) select workspace_id,'Security fixture',other_id from security_context;
insert into public.workspace_members(workspace_id,user_id,role) select workspace_id,other_id,'owner' from security_context;
insert into public.workspace_invitations(id,workspace_id,workspace_name,invited_by,invitee_id,invitee_email)
 select invitation_id,workspace_id,'Security fixture',other_id,user_id,'' from security_context;
grant select on security_context to authenticated,anon;
select set_config('request.jwt.claim.sub',user_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated','user_metadata',jsonb_build_object('is_admin',true))::text,true) from security_context;
set local role authenticated;
do $$ declare fn record; args text; begin
 if public.is_current_user_admin() then raise exception 'Self promotion via metadata'; end if;
 begin update private.admin_config set admin_user_id=auth.uid(); raise exception 'Admin config writable'; exception when insufficient_privilege then null; end;
 if exists(select 1 from private.admin_audit_log) then raise exception 'Audit disclosed'; end if;
 if exists(select 1 from public.tasks where id='security_other') then raise exception 'Private data disclosed'; end if;
 update public.tasks set title='Legitimate update' where id='security_own' and user_id=auth.uid();
 if not found then raise exception 'Ordinary user cannot edit own data'; end if;
 update public.tasks set title='Forbidden update' where id='security_other';
 if found then raise exception 'Other user data writable'; end if;
 for fn in select p.proname,p.proargtypes from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'admin_%' loop
  select string_agg('null::'||t::regtype,',') into args from unnest(fn.proargtypes::oid[]) t;
  begin execute format('select public.%I(%s)',fn.proname,coalesce(args,'')); raise exception 'Admin RPC exposed: %',fn.proname;
  exception when insufficient_privilege then null; end;
 end loop;
 perform public.respond_to_workspace_invitation((select invitation_id from security_context),true);
 if not public.is_workspace_member((select workspace_id from security_context)) then raise exception 'Normal invitation acceptance failed'; end if;
end $$;
reset role;
-- Ban the fixture account while retaining its existing simulated access claims.
update auth.users set banned_until=now()+interval '1 hour' where id=(select user_id from security_context);
set local role authenticated;
do $$ declare fn record; args text; begin
 if exists(select 1 from public.tasks) then raise exception 'Blocked account can read tasks'; end if;
 for fn in select p.proname,p.proargtypes from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname='public' and p.prosecdef and l.lanname='plpgsql' and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype) loop
  select string_agg('null::'||t::regtype,',') into args from unnest(fn.proargtypes::oid[]) t;
  begin execute format('select public.%I(%s)',fn.proname,coalesce(args,'')); raise exception 'Blocked account can call RPC: %',fn.proname;
  exception when insufficient_privilege then null; end;
 end loop;
end $$;
reset role;
-- Administrators still cannot read arbitrary personal tasks directly through RLS.
select set_config('request.jwt.claim.sub',admin_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true) from security_context;
set local role authenticated;
do $$ begin
 if not public.is_current_user_admin() then raise exception 'Fixed administrator denied'; end if;
 if exists(select 1 from public.tasks where id in ('security_own','security_other')) then raise exception 'Admin has unrestricted private data access'; end if;
 begin perform public.admin_set_user_blocked(auth.uid(),true,'Test self block'); raise exception 'Self block allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
set local role anon;
do $$ begin
 begin perform public.admin_overview(); raise exception 'Anonymous API access'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: sole admin, metadata spoofing, all admin RPCs, blocked RPCs, signup trigger, own-data RLS, invitation acceptance, self-block and anon' as security_test_result;
rollback;
