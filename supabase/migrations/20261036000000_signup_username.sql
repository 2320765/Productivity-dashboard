-- Создаёт приватную строку профиля с username из signup metadata.
-- Проверка выполняется на стороне базы; клиенты не могут записывать profiles напрямую.
create or replace function public.create_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  clean text := public.normalize_username(new.raw_user_meta_data ->> 'username');
begin
  if clean !~ '^[a-z][a-z0-9_]{2,19}$' then
    raise exception 'Invalid username format' using errcode = '22023';
  end if;

  if clean in ('admin','administrator','root','support','system','dayflow','null','undefined','moderator','owner','api') then
    raise exception 'Username is reserved' using errcode = '22023';
  end if;

  begin
    insert into public.profiles(user_id, username)
    values (new.id, clean);
  exception when unique_violation then
    raise exception 'Username already taken' using errcode = '23505';
  end;

  return new;
end;
$$;

revoke all on function public.create_profile_for_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_username on auth.users;
create trigger on_auth_user_created_username
  after insert on auth.users
  for each row execute function public.create_profile_for_new_auth_user();
