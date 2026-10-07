-- Mandatory one-account identity verification foundation.
-- Raw national ID numbers are never stored; a Vault-backed HMAC fingerprint enforces uniqueness.

create table if not exists public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  id_type text not null default 'ke_national_id' check (id_type = 'ke_national_id'),
  id_number_hmac bytea not null,
  id_number_last4 text not null check (id_number_last4 ~ '^[0-9]{4}$'),
  country_code text not null default 'KE' check (country_code = 'KE'),
  front_object_path text not null,
  back_object_path text not null,
  status text not null default 'submitted' check (status in ('submitted','under_review','approved','rejected','blocked')),
  verification_method text not null default 'manual_review' check (verification_method in ('manual_review','provider')),
  provider text,
  provider_reference text,
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id),
  unique (id_number_hmac)
);

alter table public.identity_verifications enable row level security;
revoke all on table public.identity_verifications from anon, authenticated;
grant all on table public.identity_verifications to service_role;

alter table public.profiles
  add column if not exists identity_verification_status text not null default 'not_required'
    check (identity_verification_status in ('not_required','pending','submitted','under_review','approved','rejected','blocked')),
  add column if not exists identity_verified_at timestamptz;

create or replace function public.mark_new_profile_identity_required()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.identity_verification_status = 'not_required' then
    new.identity_verification_status := 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_identity_verification_required on public.profiles;
create trigger profiles_identity_verification_required
before insert on public.profiles
for each row execute function public.mark_new_profile_identity_required();

create table if not exists public.identity_verification_events (
  id bigint generated always as identity primary key,
  verification_id uuid references public.identity_verifications(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  outcome text not null default 'success',
  actor_id uuid references auth.users(id) on delete set null,
  request_id text,
  source_ip inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.identity_verification_events enable row level security;
revoke all on table public.identity_verification_events from anon, authenticated;
grant all on table public.identity_verification_events to service_role;

create index if not exists identity_verifications_status_idx on public.identity_verifications(status);
create index if not exists identity_verification_events_user_created_idx on public.identity_verification_events(user_id, created_at desc);
create index if not exists identity_verification_events_verification_created_idx on public.identity_verification_events(verification_id, created_at desc);

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'testagram_identity_hmac_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'testagram_identity_hmac_key',
      'HMAC key used to derive non-reversible national-ID uniqueness fingerprints for Testagram identity verification.'
    );
  end if;
end $$;

create or replace function public.create_identity_verification(
  p_user_id uuid,
  p_national_id text,
  p_front_object_path text,
  p_back_object_path text,
  p_request_id text default null,
  p_source_ip inet default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, vault
as $$
declare
  normalized_id text;
  id_hmac bytea;
  existing_user uuid;
  v_id uuid;
begin
  if current_user <> 'service_role' then raise exception 'SERVICE_ONLY'; end if;
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  normalized_id := regexp_replace(coalesce(p_national_id,''), '[^0-9]', '', 'g');
  if normalized_id !~ '^[0-9]{6,12}$' then raise exception 'INVALID_NATIONAL_ID'; end if;

  select extensions.hmac(normalized_id, decrypted_secret, 'sha256') into id_hmac
  from vault.decrypted_secrets where name = 'testagram_identity_hmac_key' limit 1;
  if id_hmac is null then raise exception 'IDENTITY_HASH_KEY_UNAVAILABLE'; end if;

  select iv.user_id into existing_user from public.identity_verifications iv where iv.id_number_hmac = id_hmac limit 1;
  if existing_user is not null and existing_user <> p_user_id then
    insert into public.identity_verification_events(user_id,event_type,outcome,request_id,source_ip,user_agent,metadata)
    values(p_user_id,'DUPLICATE_ID_BLOCKED','blocked',p_request_id,p_source_ip,p_user_agent,jsonb_build_object('reason','id_already_bound'));
    raise exception 'IDENTITY_ALREADY_REGISTERED';
  end if;

  insert into public.identity_verifications(
    user_id,id_number_hmac,id_number_last4,front_object_path,back_object_path,status,
    verification_method,rejection_reason,submitted_at,reviewed_at,reviewed_by,updated_at
  )
  values(p_user_id,id_hmac,right(normalized_id,4),p_front_object_path,p_back_object_path,'submitted',
    'manual_review',null,now(),null,null,now())
  on conflict (user_id) do update set
    id_number_hmac = excluded.id_number_hmac,
    id_number_last4 = excluded.id_number_last4,
    front_object_path = excluded.front_object_path,
    back_object_path = excluded.back_object_path,
    status = 'submitted',
    verification_method = 'manual_review',
    rejection_reason = null,
    submitted_at = now(),
    reviewed_at = null,
    reviewed_by = null,
    updated_at = now()
  returning id into v_id;

  update public.profiles set identity_verification_status='submitted', identity_verified_at=null, updated_at=now() where id=p_user_id;

  insert into public.identity_verification_events(verification_id,user_id,event_type,outcome,actor_id,request_id,source_ip,user_agent,metadata)
  values(v_id,p_user_id,'IDENTITY_SUBMITTED','success',p_user_id,p_request_id,p_source_ip,p_user_agent,
    jsonb_build_object('id_type','ke_national_id','id_last4',right(normalized_id,4)));

  return jsonb_build_object('ok',true,'verification_id',v_id,'status','submitted');
end;
$$;

revoke all on function public.create_identity_verification(uuid,text,text,text,text,inet,text) from public, anon, authenticated;
grant execute on function public.create_identity_verification(uuid,text,text,text,text,inet,text) to service_role;

create or replace function public.review_identity_verification(p_verification_id uuid,p_decision text,p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_user uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.platform_control pc where pc.singleton=true and pc.owner_user_id=auth.uid()) then raise exception 'PLATFORM_OWNER_REQUIRED'; end if;
  if p_decision not in ('approved','rejected','blocked') then raise exception 'INVALID_DECISION'; end if;
  select user_id into v_user from public.identity_verifications where id=p_verification_id for update;
  if v_user is null then raise exception 'VERIFICATION_NOT_FOUND'; end if;
  update public.identity_verifications set status=p_decision,rejection_reason=case when p_decision='approved' then null else nullif(btrim(p_notes),'') end,reviewed_at=now(),reviewed_by=auth.uid(),updated_at=now() where id=p_verification_id;
  update public.profiles set identity_verification_status=p_decision,identity_verified_at=case when p_decision='approved' then now() else null end,updated_at=now() where id=v_user;
  insert into public.identity_verification_events(verification_id,user_id,event_type,outcome,actor_id,metadata)
  values(p_verification_id,v_user,'IDENTITY_REVIEWED',p_decision,auth.uid(),jsonb_build_object('decision',p_decision,'has_notes',p_notes is not null and length(btrim(p_notes))>0));
  return jsonb_build_object('ok',true,'status',p_decision);
end;
$$;

revoke all on function public.review_identity_verification(uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_identity_verification(uuid,text,text) to authenticated;

create or replace function public.get_my_identity_verification_status()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object('status',coalesce(p.identity_verification_status,'pending'),'verified_at',p.identity_verified_at)
  from public.profiles p where p.id=auth.uid()
$$;

revoke all on function public.get_my_identity_verification_status() from public, anon;
grant execute on function public.get_my_identity_verification_status() to authenticated;

create policy "identity_documents_owner_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'identity-documents'
  and exists (
    select 1 from public.platform_control pc
    where pc.singleton = true and pc.owner_user_id = (select auth.uid())
  )
);

create or replace function public.list_identity_verifications_for_owner()
returns table (
  id uuid,user_id uuid,id_type text,id_number_last4 text,country_code text,
  front_object_path text,back_object_path text,status text,verification_method text,
  provider text,provider_reference text,rejection_reason text,submitted_at timestamptz,
  reviewed_at timestamptz,reviewed_by uuid,username text,display_name text,email text
)
language sql stable security definer set search_path = pg_catalog, public
as $$
  select iv.id,iv.user_id,iv.id_type,iv.id_number_last4,iv.country_code,iv.front_object_path,iv.back_object_path,
         iv.status,iv.verification_method,iv.provider,iv.provider_reference,iv.rejection_reason,iv.submitted_at,
         iv.reviewed_at,iv.reviewed_by,p.username,p.display_name,u.email
  from public.identity_verifications iv
  join public.profiles p on p.id=iv.user_id
  join auth.users u on u.id=iv.user_id
  where exists (select 1 from public.platform_control pc where pc.singleton=true and pc.owner_user_id=auth.uid())
  order by iv.submitted_at desc
$$;

revoke all on function public.list_identity_verifications_for_owner() from public, anon, authenticated;
grant execute on function public.list_identity_verifications_for_owner() to authenticated;