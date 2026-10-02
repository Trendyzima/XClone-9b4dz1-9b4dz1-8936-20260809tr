-- Auth/profile provisioning hardening for high-volume signups.
-- The auth.users trigger creates the canonical profile once, without making
-- username collisions abort otherwise valid account creation.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  base_username text;
  candidate_username text;
  fallback_username text;
  display_name_value text;
begin
  base_username := lower(
    regexp_replace(
      coalesce(
        new.raw_user_meta_data->>'username',
        case
          when new.phone is not null then 'user_' || right(regexp_replace(new.phone, '\D', '', 'g'), 9)
          else split_part(coalesce(new.email, ''), '@', 1)
        end,
        'user_' || left(replace(new.id::text, '-', ''), 10)
      ),
      '[^a-z0-9_]+',
      '_',
      'g'
    )
  );
  base_username := left(trim(both '_' from base_username), 24);

  if char_length(base_username) < 3 then
    base_username := 'user_' || left(replace(new.id::text, '-', ''), 10);
  end if;

  fallback_username := left(base_username, 15) || '_' || left(replace(new.id::text, '-', ''), 8);
  display_name_value := coalesce(
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    base_username
  );

  candidate_username := base_username;

  begin
    insert into public.profiles(id, username, display_name, avatar_url)
    values (
      new.id,
      candidate_username,
      display_name_value,
      nullif(new.raw_user_meta_data->>'avatar_url', '')
    )
    on conflict (id) do nothing;
  exception
    when unique_violation then
      candidate_username := fallback_username;
      insert into public.profiles(id, username, display_name, avatar_url)
      values (
        new.id,
        candidate_username,
        display_name_value,
        nullif(new.raw_user_meta_data->>'avatar_url', '')
      )
      on conflict (id) do nothing;
  end;

  return new;
end;
$function$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
