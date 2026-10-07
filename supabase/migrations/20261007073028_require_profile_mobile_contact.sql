create table if not exists public.profile_contact_methods (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_e164 text not null,
  phone_verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_contact_methods_phone_format
    check (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$')
);

create unique index if not exists profile_contact_methods_phone_e164_key
  on public.profile_contact_methods (phone_e164);

alter table public.profile_contact_methods enable row level security;

revoke all on table public.profile_contact_methods from anon;
grant select, insert, update, delete on table public.profile_contact_methods to authenticated;
grant all on table public.profile_contact_methods to service_role;

drop policy if exists profile_contact_methods_owner_select on public.profile_contact_methods;
create policy profile_contact_methods_owner_select
  on public.profile_contact_methods for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists profile_contact_methods_owner_insert on public.profile_contact_methods;
create policy profile_contact_methods_owner_insert
  on public.profile_contact_methods for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists profile_contact_methods_owner_update on public.profile_contact_methods;
create policy profile_contact_methods_owner_update
  on public.profile_contact_methods for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists profile_contact_methods_owner_delete on public.profile_contact_methods;
create policy profile_contact_methods_owner_delete
  on public.profile_contact_methods for delete to authenticated
  using ((select auth.uid()) = user_id);

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

  v_normalized := regexp_replace(v_phone, '[[:space:]().-]', '', 'g');

  if v_normalized ~ '^0[17][0-9]{8}$' then
    v_normalized := '+254' || substring(v_normalized from 2);
  end if;

  if v_normalized !~ '^\\+[1-9][0-9]{7,14}$' then
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

create or replace function public.has_my_mobile_phone()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.profile_contact_methods pcm
    where pcm.user_id = (select auth.uid())
      and pcm.phone_e164 is not null
  );
$$;

revoke execute on function public.has_my_mobile_phone() from public, anon;
grant execute on function public.has_my_mobile_phone() to authenticated;
