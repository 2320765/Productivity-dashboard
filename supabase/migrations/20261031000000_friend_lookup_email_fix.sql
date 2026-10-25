-- Поиск по точному email должен работать и у аккаунтов без имени в профиле.
drop function if exists public.lookup_friend(text);
create function public.lookup_friend(p_query text)
returns table(user_id uuid, display_name text, avatar_url text)
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare caller uuid := auth.uid(); last_lookup timestamptz;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if char_length(trim(coalesce(p_query, ''))) < 3 or char_length(p_query) > 320 then
    raise exception 'Enter an exact email or display name (at least 3 characters)' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  select max(log_row.created_at) into last_lookup from public.friend_lookup_log log_row where log_row.user_id = caller;
  if last_lookup > now() - interval '3 seconds' then raise exception 'Please wait before searching again' using errcode = 'P0001'; end if;
  insert into public.friend_lookup_log(user_id) values (caller);
  return query
  select account.id,
    coalesce(nullif(account.raw_user_meta_data ->> 'full_name', ''), nullif(account.raw_user_meta_data ->> 'name', ''), 'Пользователь'),
    nullif(account.raw_user_meta_data ->> 'avatar_url', '')
  from auth.users account where account.id <> caller and (
    (account.email is not null and lower(account.email) = lower(trim(p_query))) or
    lower(coalesce(nullif(account.raw_user_meta_data ->> 'full_name', ''), nullif(account.raw_user_meta_data ->> 'name', ''), '')) = lower(trim(p_query))
  )
  limit 1;
end;
$$;

revoke all on function public.lookup_friend(text) from public, anon;
grant execute on function public.lookup_friend(text) to authenticated;
