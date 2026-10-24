alter table public.workspace_members drop constraint if exists workspace_members_role_check;
update public.workspace_members member set role = case when member.user_id = workspace.owner_id then 'owner' when member.role = 'owner' then 'member' else member.role end
from public.workspaces workspace where workspace.id = member.workspace_id;
insert into public.workspace_members(workspace_id, user_id, role)
select id, owner_id, 'owner' from public.workspaces
on conflict (workspace_id, user_id) do update set role = 'owner';
alter table public.workspace_members add constraint workspace_members_role_check check (role in ('owner', 'admin', 'member'));

create or replace function public.is_workspace_admin(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=(select auth.uid()) and m.role='admin'); $$;
create or replace function public.can_manage_workspace(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select public.is_workspace_owner(p_workspace_id) or public.is_workspace_admin(p_workspace_id); $$;

create or replace function public.workspace_member_labels(p_workspace_id uuid)
returns table(user_id uuid, role text, display_name text)
language plpgsql stable security definer set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then raise exception 'Workspace membership required' using errcode='42501'; end if;
  return query select m.user_id, m.role, case when m.user_id=auth.uid() then 'Вы' else coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name',''),'Участник') end
    from public.workspace_members m join auth.users u on u.id=m.user_id where m.workspace_id=p_workspace_id
    order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at;
end; $$;

create or replace function public.set_workspace_member_role(p_workspace_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not public.is_workspace_owner(p_workspace_id) then raise exception 'Only owner can change administrator roles' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if p_role not in ('admin','member') then raise exception 'Invalid assignable role' using errcode='22023'; end if;
  update public.workspace_members set role=p_role where workspace_id=p_workspace_id and user_id=p_user_id and role<>'owner';
  if not found then raise exception 'Workspace participant not found' using errcode='P0002'; end if;
end; $$;

create or replace function public.transfer_workspace_ownership(p_workspace_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare caller uuid:=auth.uid();
begin
  if caller is null then raise exception 'Authentication required' using errcode='28000'; end if;
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not public.is_workspace_owner(p_workspace_id) then raise exception 'Only owner can transfer ownership' using errcode='42501'; end if;
  if p_user_id is null or p_user_id=caller or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and role<>'owner') then raise exception 'Choose another current participant' using errcode='22023'; end if;
  update public.workspace_members set role='admin' where workspace_id=p_workspace_id and user_id=caller and role='owner';
  update public.workspace_members set role='owner' where workspace_id=p_workspace_id and user_id=p_user_id;
  update public.workspaces set owner_id=p_user_id where id=p_workspace_id;
end; $$;

create or replace function public.rename_workspace(p_workspace_id uuid,p_name text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not public.is_workspace_owner(p_workspace_id) then raise exception 'Only owner can rename workspace' using errcode='42501'; end if;
  if char_length(trim(coalesce(p_name,''))) not between 1 and 80 then raise exception 'Workspace name must be 1-80 characters' using errcode='22023'; end if;
  update public.workspaces set name=trim(p_name) where id=p_workspace_id;
  update public.workspace_invitations set workspace_name=trim(p_name),updated_at=now() where workspace_id=p_workspace_id and status='pending';
end; $$;

create or replace function public.remove_workspace_member(p_workspace_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare caller_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  perform 1 from public.workspaces where id=p_workspace_id for update;
  select role into caller_role from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid();
  if caller_role is null or caller_role not in ('owner','admin') or p_user_id=auth.uid() then raise exception 'Insufficient permission to remove participant' using errcode='42501'; end if;
  if exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and role='owner') then raise exception 'Transfer ownership before removing owner' using errcode='42501'; end if;
  if caller_role='admin' and exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and role='admin') then raise exception 'Administrators cannot remove administrators' using errcode='42501'; end if;
  delete from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and role in ('admin','member');
  if not found then raise exception 'Workspace participant not found' using errcode='P0002'; end if;
end; $$;

create or replace function public.leave_workspace(p_workspace_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  delete from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid() and role in ('admin','member');
  if not found then raise exception 'Owner must transfer ownership before leaving' using errcode='42501'; end if;
end; $$;

create or replace function public.send_workspace_invitation(p_workspace_id uuid,p_email text)
returns void language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare caller uuid:=auth.uid(); target_id uuid; target_email text; ws_name text;
begin
  if caller is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not public.can_manage_workspace(p_workspace_id) then raise exception 'Workspace administrator permission required' using errcode='42501'; end if;
  if char_length(trim(coalesce(p_email,''))) not between 3 and 320 or position('@' in p_email)<2 then raise exception 'Enter a valid email address' using errcode='22023'; end if;
  select id,email into target_id,target_email from auth.users where lower(email)=lower(trim(p_email)) limit 1;
  if target_id is null then raise exception 'Registered user not found' using errcode='P0002'; end if;
  if target_id=caller then raise exception 'Cannot invite yourself' using errcode='22023'; end if;
  if exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=target_id) then raise exception 'Already a workspace member' using errcode='23505'; end if;
  if exists(select 1 from public.workspace_invitations where workspace_id=p_workspace_id and invitee_id=target_id and status='pending') then raise exception 'Invitation already pending' using errcode='23505'; end if;
  select name into ws_name from public.workspaces where id=p_workspace_id;
  insert into public.workspace_invitations(workspace_id,workspace_name,invited_by,invitee_id,invitee_email) values(p_workspace_id,ws_name,caller,target_id,target_email) on conflict(workspace_id,invitee_id) where status='pending' do nothing;
  if not found then raise exception 'Invitation already pending' using errcode='23505'; end if;
end; $$;

create or replace function public.send_workspace_invitation_to_user(p_workspace_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare caller uuid:=auth.uid(); target_email text; ws_name text;
begin
  if caller is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not public.can_manage_workspace(p_workspace_id) then raise exception 'Workspace administrator permission required' using errcode='42501'; end if;
  if p_user_id is null or p_user_id=caller then raise exception 'Invalid invitee' using errcode='22023'; end if;
  select email into target_email from auth.users where id=p_user_id;
  if target_email is null then raise exception 'User not found' using errcode='P0002'; end if;
  if exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id) then raise exception 'Already a workspace member' using errcode='23505'; end if;
  if exists(select 1 from public.workspace_invitations where workspace_id=p_workspace_id and invitee_id=p_user_id and status='pending') then raise exception 'Invitation already pending' using errcode='23505'; end if;
  if not exists(select 1 from public.friendships where status='accepted' and user_low=least(caller,p_user_id) and user_high=greatest(caller,p_user_id)) then raise exception 'Friend relationship required' using errcode='42501'; end if;
  select name into ws_name from public.workspaces where id=p_workspace_id;
  insert into public.workspace_invitations(workspace_id,workspace_name,invited_by,invitee_id,invitee_email) values(p_workspace_id,ws_name,caller,p_user_id,target_email);
end; $$;

create or replace function public.cancel_workspace_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare ws_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select workspace_id into ws_id from public.workspace_invitations where id=p_invitation_id and status='pending';
  if ws_id is null or not public.can_manage_workspace(ws_id) then raise exception 'Invitation cannot be cancelled' using errcode='42501'; end if;
  update public.workspace_invitations set status='cancelled',updated_at=now() where id=p_invitation_id and status='pending';
end; $$;

create or replace function public.workspace_invitations_for_user()
returns table(id uuid,workspace_id uuid,workspace_name text,invited_by uuid,invitee_id uuid,invitee_name text,status text,created_at timestamptz)
language plpgsql stable security definer set search_path=public,auth,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  return query select i.id,i.workspace_id,i.workspace_name,i.invited_by,i.invitee_id,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name',''),'Пользователь'),i.status,i.created_at
    from public.workspace_invitations i join auth.users u on u.id=i.invitee_id
    where i.invitee_id=auth.uid() or (i.invited_by=auth.uid() and public.can_manage_workspace(i.workspace_id)) order by i.created_at desc;
end; $$;

revoke all on function public.is_workspace_admin(uuid),public.can_manage_workspace(uuid) from public,anon;
revoke all on function public.set_workspace_member_role(uuid,uuid,text),public.transfer_workspace_ownership(uuid,uuid),public.rename_workspace(uuid,text) from public,anon;
grant execute on function public.is_workspace_admin(uuid),public.can_manage_workspace(uuid) to authenticated;
grant execute on function public.set_workspace_member_role(uuid,uuid,text),public.transfer_workspace_ownership(uuid,uuid),public.rename_workspace(uuid,text) to authenticated;
grant execute on function public.remove_workspace_member(uuid,uuid),public.leave_workspace(uuid),public.send_workspace_invitation(uuid,text),public.send_workspace_invitation_to_user(uuid,uuid),public.cancel_workspace_invitation(uuid),public.workspace_invitations_for_user() to authenticated;
