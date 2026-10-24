create or replace function public.workspace_invitations_for_user()
returns table(id uuid, workspace_id uuid, workspace_name text, invited_by uuid,
              invitee_id uuid, invitee_name text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  return query
  select invitation.id, invitation.workspace_id, invitation.workspace_name,
    invitation.invited_by, invitation.invitee_id,
    coalesce(nullif(invitee.raw_user_meta_data ->> 'full_name', ''), nullif(invitee.raw_user_meta_data ->> 'name', ''), 'Пользователь'),
    invitation.status, invitation.created_at
  from public.workspace_invitations invitation
  join auth.users invitee on invitee.id = invitation.invitee_id
  where invitation.invitee_id = auth.uid()
     or (invitation.invited_by = auth.uid() and public.is_workspace_owner(invitation.workspace_id))
  order by invitation.created_at desc;
end;
$$;

create or replace function public.send_workspace_invitation_to_user(p_workspace_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare caller uuid := auth.uid(); invitee_email text; workspace_label text;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not public.is_workspace_owner(p_workspace_id) then raise exception 'Only the workspace owner can invite members' using errcode = '42501'; end if;
  if p_user_id is null or p_user_id = caller then raise exception 'Invalid invitee' using errcode = '22023'; end if;
  select email into invitee_email from auth.users where id = p_user_id;
  if invitee_email is null then raise exception 'User not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id) then
    raise exception 'User is already a workspace member' using errcode = '23505';
  end if;
  if exists (select 1 from public.workspace_invitations where workspace_id = p_workspace_id and invitee_id = p_user_id and status = 'pending') then
    raise exception 'An invitation is already pending' using errcode = '23505';
  end if;
  if not exists (select 1 from public.friendships where status = 'accepted'
    and user_low = least(caller, p_user_id) and user_high = greatest(caller, p_user_id)) then
    raise exception 'Friend relationship required for this invitation method' using errcode = '42501';
  end if;
  select name into workspace_label from public.workspaces where id = p_workspace_id;
  insert into public.workspace_invitations(workspace_id, workspace_name, invited_by, invitee_id, invitee_email)
  values (p_workspace_id, workspace_label, caller, p_user_id, invitee_email);
end;
$$;

create or replace function public.send_workspace_invitation(p_workspace_id uuid, p_email text)
returns void language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare caller uuid := auth.uid(); target_id uuid; target_email text; workspace_label text;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not public.is_workspace_owner(p_workspace_id) then raise exception 'Only the workspace owner can invite members' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_email, ''))) not between 3 and 320 or position('@' in p_email) < 2 then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  select id, email into target_id, target_email from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if target_id is null then raise exception 'Registered user not found' using errcode = 'P0002'; end if;
  if target_id = caller then raise exception 'Cannot invite yourself' using errcode = '22023'; end if;
  if exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = target_id) then
    raise exception 'User is already a workspace member' using errcode = '23505';
  end if;
  if exists (select 1 from public.workspace_invitations where workspace_id = p_workspace_id and invitee_id = target_id and status = 'pending') then
    raise exception 'An invitation is already pending' using errcode = '23505';
  end if;
  select name into workspace_label from public.workspaces where id = p_workspace_id;
  insert into public.workspace_invitations(workspace_id, workspace_name, invited_by, invitee_id, invitee_email)
  values (p_workspace_id, workspace_label, caller, target_id, target_email)
  on conflict (workspace_id, invitee_id) where status = 'pending' do nothing;
  if not found then raise exception 'An invitation is already pending' using errcode = '23505'; end if;
end;
$$;

revoke all on function public.workspace_invitations_for_user() from public, anon;
revoke all on function public.send_workspace_invitation_to_user(uuid, uuid) from public, anon;
grant execute on function public.workspace_invitations_for_user() to authenticated;
grant execute on function public.send_workspace_invitation_to_user(uuid, uuid) to authenticated;
revoke all on function public.send_workspace_invitation(uuid, text) from public, anon;
grant execute on function public.send_workspace_invitation(uuid, text) to authenticated;
