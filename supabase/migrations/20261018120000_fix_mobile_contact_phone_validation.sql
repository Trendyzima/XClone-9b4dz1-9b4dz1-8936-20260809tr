-- Repair phone validation introduced by the required mobile-contact migration.
-- Use [+] rather than an escaped plus so SQL-string and regex escaping cannot
-- accidentally make every correctly formatted E.164 number fail validation.
alter table public.profile_contact_methods
  drop constraint if exists profile_contact_methods_phone_format;
alter table public.profile_contact_methods
  add constraint profile_contact_methods_phone_format
  check (phone_e164 ~ '^[+][1-9][0-9]{7,14}$');

create or replace function public.set_my_mobile_phone(p_phone text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_phone text := btrim(coalesce(p_phone, ''));
  v_normalized text;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  -- Remove presentation separators only; do not silently discard arbitrary
  -- letters or extensions that could turn invalid input into another number.
  v_normalized := regexp_replace(v_phone, '[[:space:]().-]', '', 'g');

  -- Accept common Kenyan national mobile forms and store them canonically.
  if v_normalized ~ '^0[17][0-9]{8}$' then
    v_normalized := '+254' || substring(v_normalized from 2);
  end if;

  if v_normalized !~ '^[+][1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'Enter a valid mobile number in international format, e.g. +254712345678';
  end if;

  insert into public.profile_contact_methods(user_id, phone_e164, phone_verified_at, updated_at)
  values (v_user_id, v_normalized, null, now())
  on conflict (user_id) do update
    set phone_e164 = excluded.phone_e164,
        phone_verified_at = case
          when public.profile_contact_methods.phone_e164 is distinct from excluded.phone_e164 then null
          else public.profile_contact_methods.phone_verified_at
        end,
        updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'phone_e164', v_normalized,
    'verified', exists (
      select 1 from public.profile_contact_methods pcm
      where pcm.user_id = v_user_id and pcm.phone_verified_at is not null
    )
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'That mobile number is already associated with another Testagram account';
end;
$$;

revoke execute on function public.set_my_mobile_phone(text) from public, anon;
grant execute on function public.set_my_mobile_phone(text) to authenticated;
