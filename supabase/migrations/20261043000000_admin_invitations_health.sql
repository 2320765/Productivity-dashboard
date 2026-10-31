-- 1) Приглашения: срок действия, админский просмотр и отмена с обязательной причиной.
-- 2) Состояние сайта и синхронизации: время последней успешной синхронизации и
--    ограниченный журнал безопасных ошибок клиента (только категория и короткий код).
-- Администратор не может принимать приглашения: respond_to_workspace_invitation
-- по-прежнему требует invitee_id = auth.uid().

alter table public.workspace_invitations add column if not exists expires_at timestamptz;
update public.workspace_invitations set expires_at = created_at + interval '14 days' where expires_at is null;
alter table public.workspace_invitations alter column expires_at set default (now() + interval '14 days');
alter table public.workspace_invitations alter column expires_at set not null;

alter table public.workspace_invitations drop constraint if exists workspace_invitations_status_check;
alter table public.workspace_invitations
  add constraint workspace_invitations_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired'));

-- Помечает просроченные приглашения, чтобы отправитель мог выслать новое.
create or replace function private.expire_stale_invitations(p_workspace_id uuid, p_invitee_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, pg_temp
as $$
  update public.workspace_invitations
     set status = 'expired', updated_at = now()
   where workspace_id = p_workspace_id and invitee_id = p_invitee_id
     and status = 'pending' and expires_at <= now();
$$;
revoke all on function private.expire_stale_invitations(uuid, uuid) from public, anon, authenticated;

create or replace function public.send_workspace_invitation(p_workspace_id uuid,p_email text)
returns void language plpgsql security definer set search_path = public,auth,pg_temp as $$
declare caller uuid:=auth.uid(); target_id uuid; target_email text; ws_name text;
begin
  if caller is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not public.can_manage_workspace(p_workspace_id) then raise exception 'Workspace administrator permission required' using errcode='42501'; end if;
  if char_length(trim(coalesce(p_email,''))) not between 3 and 320 or position('@' in p_email)<2 then raise exception 'Enter a valid email address' using errcode='22023'; end if;
  select id,email into target_id,target_email from auth.users where lower(email)=lower(trim(p_email)) limit 1;
  if target_id is null then raise exception 'Registered user not found' using errcode='P0002'; end if;
  if target_id=caller then raise exception 'Cannot invite yourself' using errcode='22023'; end if;
  if exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=target_id) then raise exception 'Already a workspace member' using errcode='23505'; end if;
  perform private.expire_stale_invitations(p_workspace_id, target_id);
  if exists(select 1 from public.workspace_invitations where workspace_id=p_workspace_id and invitee_id=target_id and status='pending') then raise exception 'Invitation already pending' using errcode='23505'; end if;
  select name into ws_name from public.workspaces where id=p_workspace_id;
  insert into public.workspace_invitations(workspace_id,workspace_name,invited_by,invitee_id,invitee_email) values(p_workspace_id,ws_name,caller,target_id,target_email) on conflict(workspace_id,invitee_id) where status='pending' do nothing;
  if not found then raise exception 'Invitation already pending' using errcode='23505'; end if;
end; $$;

create or replace function public.send_workspace_invitation_to_user(p_workspace_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path = public,auth,pg_temp as $$
declare caller uuid := auth.uid(); ws_name text;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not public.can_manage_workspace(p_workspace_id) then raise exception 'Workspace administrator permission required' using errcode = '42501'; end if;
  if p_user_id is null or p_user_id = caller then raise exception 'Invalid invitee' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users where id = p_user_id) then raise exception 'User not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id) then raise exception 'Already a workspace member' using errcode = '23505'; end if;
  perform private.expire_stale_invitations(p_workspace_id, p_user_id);
  if exists (select 1 from public.workspace_invitations where workspace_id = p_workspace_id and invitee_id = p_user_id and status = 'pending') then raise exception 'Invitation already pending' using errcode = '23505'; end if;
  if not exists (select 1 from public.friendships where status = 'accepted' and user_low = least(caller, p_user_id) and user_high = greatest(caller, p_user_id)) then raise exception 'Friend relationship required' using errcode = '42501'; end if;
  select name into ws_name from public.workspaces where id = p_workspace_id;
  insert into public.workspace_invitations(workspace_id, workspace_name, invited_by, invitee_id, invitee_email)
  values (p_workspace_id, ws_name, caller, p_user_id, '');
end; $$;

-- Принять просроченное приглашение нельзя.
create or replace function public.respond_to_workspace_invitation(p_invitation_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
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
  if invitation.expires_at <= now() then
    raise exception 'Invitation has expired' using errcode = 'P0002';
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

-- Просроченные ожидающие приглашения показываются со статусом expired.
create or replace function public.workspace_invitations_for_user()
returns table(id uuid, workspace_id uuid, workspace_name text, invited_by uuid, invitee_id uuid, invitee_name text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  return query select i.id,i.workspace_id,i.workspace_name,i.invited_by,i.invitee_id,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name',''),'Пользователь'),
      case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end,i.created_at
    from public.workspace_invitations i join auth.users u on u.id=i.invitee_id
    where i.invitee_id=auth.uid() or (i.invited_by=auth.uid() and public.can_manage_workspace(i.workspace_id)) order by i.created_at desc;
end; $$;

-- Список приглашений для администратора (без email).
create or replace function public.admin_list_invitations(p_status text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  off integer := greatest(coalesce(p_offset, 0), 0);
  wanted text := nullif(trim(coalesce(p_status, '')), '');
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if wanted is not null and wanted not in ('pending', 'expired', 'accepted', 'declined', 'cancelled') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;

  with base as (
    select i.id, i.workspace_id, i.invited_by, i.invitee_id, i.created_at, i.expires_at,
           case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end as eff_status
      from public.workspace_invitations i
  ), matched as (
    select * from base where wanted is null or eff_status = wanted
  ), page as (
    select * from matched order by created_at desc, id limit lim offset off
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id,
        'status', page.eff_status,
        'sender', case when page.invited_by is null then null else private.person_label(page.invited_by) end,
        'recipient', case when page.invitee_id is null then null else private.person_label(page.invitee_id) end,
        'workspace', (select w.name from public.workspaces w where w.id = page.workspace_id),
        'created_at', page.created_at,
        'expires_at', page.expires_at
      ) order by page.created_at desc, page.id)
      from page
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_list_invitations(text, integer, integer) from public, anon;
grant execute on function public.admin_list_invitations(text, integer, integer) to authenticated;

-- Отмена теперь требует причину (3-200 символов) и подтверждение.
create or replace function public.admin_cancel_workspace_invitation(p_invitation_id uuid, p_confirm boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := left(trim(coalesce(p_reason, '')), 200);
  inv record;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if p_confirm is distinct from true then
    raise exception 'Confirmation required' using errcode = '22023';
  end if;
  if char_length(clean_reason) < 3 then
    raise exception 'Reason is required (3-200 characters)' using errcode = '22023';
  end if;

  select i.id, i.workspace_id, i.invitee_id, w.name
    into inv
    from public.workspace_invitations i
    left join public.workspaces w on w.id = i.workspace_id
   where i.id = p_invitation_id and i.status = 'pending'
   for update of i;
  if not found then
    raise exception 'Pending invitation not found' using errcode = 'P0002';
  end if;

  update public.workspace_invitations set status = 'cancelled', updated_at = now() where id = inv.id;

  insert into private.admin_audit_log (admin_id, action, target_user_id, reason, workspace_id, workspace_name)
  values (caller, 'cancel_invitation', inv.invitee_id, clean_reason, inv.workspace_id, inv.name);
end;
$$;

revoke all on function public.admin_cancel_workspace_invitation(uuid, boolean, text) from public, anon;
grant execute on function public.admin_cancel_workspace_invitation(uuid, boolean, text) to authenticated;

-- ===== Состояние сайта и синхронизации =====

-- Время последней успешной синхронизации: проставляется только триггером.
alter table public.dashboard_revisions add column if not exists synced_at timestamptz;

create or replace function private.touch_dashboard_synced_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.synced_at := now();
  return new;
end;
$$;
revoke all on function private.touch_dashboard_synced_at() from public, anon, authenticated;

drop trigger if exists dashboard_revisions_synced_at on public.dashboard_revisions;
create trigger dashboard_revisions_synced_at
  before insert or update on public.dashboard_revisions
  for each row execute function private.touch_dashboard_synced_at();

-- Безопасные ошибки клиента: только категория и короткий код, без сообщений и текста данных.
create table if not exists private.client_error_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  category text not null check (category in ('sync', 'realtime', 'load', 'local_storage')),
  code text not null check (code ~ '^[A-Za-z0-9_.:-]{1,24}$'),
  created_at timestamptz not null default now()
);
alter table private.client_error_log enable row level security;
revoke all on private.client_error_log from public, anon, authenticated;
create index if not exists client_error_log_created_idx on private.client_error_log (created_at desc);
create index if not exists client_error_log_user_idx on private.client_error_log (user_id, created_at desc);

-- Клиент сообщает только категорию и код. Лимит: 10 событий в час на пользователя,
-- хранение 30 дней. Заблокированным пользователям и неверным значениям - молча ничего.
create or replace function public.report_client_error(p_category text, p_code text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_category not in ('sync', 'realtime', 'load', 'local_storage')
     or p_code !~ '^[A-Za-z0-9_.:-]{1,24}$'
     or private.is_blocked() then
    return;
  end if;
  if (select count(*) from private.client_error_log where user_id = caller and created_at > now() - interval '1 hour') >= 10 then
    return;
  end if;

  insert into private.client_error_log (user_id, category, code) values (caller, p_category, p_code);
  if random() < 0.05 then
    delete from private.client_error_log where created_at < now() - interval '30 days';
  end if;
end;
$$;

revoke all on function public.report_client_error(text, text) from public, anon;
grant execute on function public.report_client_error(text, text) to authenticated;

-- Сводка для администратора: время БД, последняя синхронизация, ошибки по периоду и категории.
create or replace function public.admin_health(p_hours integer default 24, p_category text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  hours integer := least(greatest(coalesce(p_hours, 24), 1), 720);
  cat text := nullif(trim(coalesce(p_category, '')), '');
  since timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_admin() then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;
  if cat is not null and cat not in ('sync', 'realtime', 'load', 'local_storage') then
    raise exception 'Unknown category' using errcode = '22023';
  end if;
  since := now() - make_interval(hours => hours);

  return jsonb_build_object(
    'server_time', now(),
    'last_sync_at', (select max(synced_at) from public.dashboard_revisions),
    'syncs_last_24h', (select count(*) from public.dashboard_revisions where synced_at > now() - interval '24 hours'),
    'error_total', (select count(*) from private.client_error_log where created_at >= since),
    'by_category', coalesce((
      select jsonb_object_agg(category, n)
      from (select category, count(*) n from private.client_error_log where created_at >= since group by category) c
    ), '{}'::jsonb),
    'errors', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'category', e.category, 'code', e.code, 'created_at', e.created_at)
                       order by e.created_at desc, e.id desc)
      from (
        select id, category, code, created_at from private.client_error_log
         where created_at >= since and (cat is null or category = cat)
         order by created_at desc, id desc limit 50
      ) e
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_health(integer, text) from public, anon;
grant execute on function public.admin_health(integer, text) to authenticated;
