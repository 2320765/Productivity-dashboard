-- Run in SQL editor / execute_sql as postgres. Everything is rolled back.
-- Auth claims are set only by this privileged harness to simulate PostgREST roles.
begin;
create temporary table audit_test_context(admin_id uuid, user_id uuid, workspace_id uuid, invitation_id uuid);
insert into audit_test_context select admin_user_id, gen_random_uuid(), gen_random_uuid(), gen_random_uuid() from private.admin_config where singleton;
do $$ begin
 if (select count(*) from audit_test_context) <> 1 then raise exception 'Configure the sole administrator before testing'; end if;
end $$;
insert into auth.users(id, aud, role, raw_user_meta_data) select user_id,'authenticated','authenticated',jsonb_build_object('username','audit_' || left(replace(user_id::text,'-',''),14)) from audit_test_context;
insert into public.workspaces(id,name,owner_id) select workspace_id,'Audit test fixture',admin_id from audit_test_context;
insert into public.workspace_members(workspace_id,user_id,role) select workspace_id,admin_id,'owner' from audit_test_context;
insert into public.workspace_members(workspace_id,user_id,role) select workspace_id,user_id,'member' from audit_test_context;
insert into public.workspace_invitations(id,workspace_id,workspace_name,invited_by,invitee_id,invitee_email)
 select invitation_id,workspace_id,'Audit test fixture',admin_id,user_id,'' from audit_test_context;
select set_config('request.jwt.claim.sub',admin_id::text,true), set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true) from audit_test_context;
grant select on audit_test_context to authenticated,anon;
set local role authenticated;
-- The client may request the operation/reason, never the actor, event time or event action.
select public.admin_find_records(user_id::text,'Проверка диагностики') from audit_test_context;
select public.admin_set_user_blocked(user_id,true,'Проверка блокировки') from audit_test_context;
select public.admin_set_user_blocked(user_id,false,'Проверка разблокировки') from audit_test_context;
select public.admin_cancel_workspace_invitation(invitation_id,true,'Проверка отмены') from audit_test_context;
select public.set_workspace_member_role(workspace_id,user_id,'admin') from audit_test_context;
select public.admin_restore_workspace_owner(workspace_id,user_id,true,'Проверка владельца') from audit_test_context;
reset role;
-- Direct trusted correction uses the same trigger as a future support RPC.
update public.workspaces set name='Corrected fixture' where id=(select workspace_id from audit_test_context);
insert into public.tasks(user_id,id,title,category,task_date,priority,status,notes)
 select user_id,'audit_test_record','CONTENT_MUST_NOT_BE_LOGGED','test',current_date,'Средний','К выполнению','SECRET_CONTENT_MUST_NOT_BE_LOGGED' from audit_test_context;
update public.tasks set title='REPLACEMENT_MUST_NOT_BE_LOGGED' where id='audit_test_record' and user_id=(select user_id from audit_test_context);
delete from public.workspace_members where workspace_id=(select workspace_id from audit_test_context) and user_id=(select admin_id from audit_test_context);
insert into public.workspace_members(workspace_id,user_id,role) select workspace_id,admin_id,'member' from audit_test_context;
do $$ declare c audit_test_context%rowtype; a text; n integer; begin
 select * into c from audit_test_context;
 foreach a in array array['search_records','block_user','unblock_user','cancel_invitation','change_member','change_owner','correct_record','remove_member','add_member'] loop
   if not exists(select 1 from private.admin_audit_log where admin_id=c.admin_id and action=a and (workspace_id=c.workspace_id or target_user_id=c.user_id)) then
     raise exception 'Missing automatic event: %',a;
   end if;
 end loop;
 select count(*) into n from private.admin_audit_log where action='cancel_invitation' and object_id=c.invitation_id::text;
 if n<>1 then raise exception 'Cancellation must generate exactly one event, got %',n; end if;
 if exists(select 1 from private.admin_audit_log where target_user_id=c.user_id and (to_jsonb(admin_audit_log)::text like '%MUST_NOT_BE_LOGGED%' or workspace_name is not null)) then
   raise exception 'User content leaked into audit';
 end if;
 if public.admin_audit_search(100,0,now()-interval '1 hour',now()+interval '1 hour','cancel_invitation','workspace_invitations',c.invitation_id::text)->>'total' <> '1' then
   raise exception 'Combined filters failed';
 end if;
end $$;
-- A failed administrative request must leave neither a mutation nor an event.
do $$ declare n bigint; u uuid; begin
 select user_id into u from audit_test_context;
 select count(*) into n from private.admin_audit_log;
 begin perform public.admin_set_user_blocked(u,true,'token=DO_NOT_RETAIN');
   raise exception 'CREDENTIAL REASON ACCEPTED'; exception when invalid_parameter_value then null; end;
 if exists(select 1 from auth.users where id=u and banned_until>now()) then raise exception 'FAILED REQUEST MUTATED USER'; end if;
 if (select count(*) from private.admin_audit_log)<>n then raise exception 'FAILED REQUEST LOGGED'; end if;
end $$;
-- If audit insertion fails, the business mutation must roll back as well.
do $$ declare n bigint; original_name text; begin
 select count(*) into n from private.admin_audit_log;
 select name into original_name from public.workspaces where id=(select workspace_id from audit_test_context);
 perform set_config('app.admin_audit_reason','x',true);
 begin update public.workspaces set name='Must roll back' where id=(select workspace_id from audit_test_context);
   raise exception 'INVALID AUDIT REASON ACCEPTED'; exception when invalid_parameter_value then null; end;
 perform set_config('app.admin_audit_reason','',true);
 if (select name from public.workspaces where id=(select workspace_id from audit_test_context))<>original_name then raise exception 'AUDIT FAILURE DID NOT ROLL BACK MUTATION'; end if;
 if (select count(*) from private.admin_audit_log)<>n then raise exception 'FAILED AUDIT INSERT LEFT AN EVENT'; end if;
end $$;
-- Audit insert/update/delete/truncate are rejected even for the real administrator.
set local role authenticated;
do $$ begin
 if not exists(select 1 from private.admin_audit_log) then raise exception 'ADMIN RLS READ DENIED'; end if;
 if jsonb_typeof(public.admin_audit_events(20)) <> 'array' then raise exception 'LEGACY API INCOMPATIBLE'; end if;
 if (public.admin_audit_search(100)->>'total')::int < 1 then raise exception 'ADMIN RPC READ DENIED'; end if;
 begin insert into private.admin_audit_log(admin_id,action,object_type,reason,created_at) values((select user_id from audit_test_context),'block_user','user','Поддельное событие','2000-01-01'); raise exception 'FORGED INSERT ALLOWED'; exception when insufficient_privilege then null; end;
 begin update private.admin_audit_log set reason='Подмена'; raise exception 'AUDIT UPDATE ALLOWED'; exception when insufficient_privilege then null; end;
 begin delete from private.admin_audit_log; raise exception 'AUDIT DELETE ALLOWED'; exception when insufficient_privilege then null; end;
 begin truncate private.admin_audit_log; raise exception 'AUDIT TRUNCATE ALLOWED'; exception when insufficient_privilege then null; end;
 begin perform private.capture_admin_change(); raise exception 'INTERNAL WRITER EXPOSED'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Trigger immutability also rejects owner-level writes unless an owner explicitly removes protection.
do $$ begin
 begin update private.admin_audit_log set reason='Подмена'; raise exception 'OWNER UPDATE ALLOWED'; exception when insufficient_privilege then null; end;
 begin delete from private.admin_audit_log; raise exception 'OWNER DELETE ALLOWED'; exception when insufficient_privilege then null; end;
 begin truncate private.admin_audit_log; raise exception 'OWNER TRUNCATE ALLOWED'; exception when insufficient_privilege then null; end;
end $$;
-- Ordinary users see zero rows via RLS and cannot invoke admin RPCs, even with forged user_metadata.
select set_config('request.jwt.claim.sub',user_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated','user_metadata',jsonb_build_object('is_admin',true))::text,true) from audit_test_context;
set local role authenticated;
do $$ begin
 if exists(select 1 from private.admin_audit_log) then raise exception 'USER READ ALLOWED'; end if;
 begin perform public.admin_audit_search(); raise exception 'USER RPC READ ALLOWED'; exception when insufficient_privilege then null; end;
 begin perform public.admin_set_user_blocked((select admin_id from audit_test_context),true,'Подделка полномочий'); raise exception 'USER ADMIN WRITE ALLOWED'; exception when insufficient_privilege then null; end;
 begin insert into private.admin_audit_log(admin_id,action,object_type,reason) values(auth.uid(),'block_user','user','Подделка'); raise exception 'USER AUDIT INSERT ALLOWED'; exception when insufficient_privilege then null; end;
 begin update private.admin_audit_log set reason='Подделка'; raise exception 'USER AUDIT UPDATE ALLOWED'; exception when insufficient_privilege then null; end;
 begin delete from private.admin_audit_log; raise exception 'USER AUDIT DELETE ALLOWED'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- An ordinary user's legitimate task edit must not impersonate an administrator in the audit.
create temporary table audit_test_count as select count(*) n from private.admin_audit_log;
set local role authenticated;
update public.tasks set title='Ordinary update' where id='audit_test_record' and user_id=auth.uid();
reset role;
do $$ begin
 if (select count(*) from private.admin_audit_log) <> (select n from audit_test_count) then raise exception 'USER FORGED ADMIN EVENT'; end if;
end $$;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
set local role anon;
do $$ begin
 begin perform public.admin_audit_search(); raise exception 'ANON RPC ALLOWED'; exception when insufficient_privilege then null; end;
 begin perform 1 from private.admin_audit_log; raise exception 'ANON READ ALLOWED'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: automatic events, filters, minimal data, RLS, spoofing and immutability' as audit_test_result;
rollback;
