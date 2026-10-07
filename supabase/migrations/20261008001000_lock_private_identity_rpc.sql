-- Keep private KYC data unexposed. Edge Functions access it through a
-- service-role-only RPC instead of supabase-js .schema('private') calls.
create or replace function public.identity_signup_db(p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  sid uuid;
  iid uuid;
begin
  if p_action = 'get_intent' then
    select to_jsonb(x) into r from private.identity_signup_intents x
    where x.registration_token_hash = p_payload->>'registration_token_hash' limit 1;
    return coalesce(r,'null'::jsonb);
  elsif p_action = 'find_email' then
    select jsonb_build_object('id',x.id) into r from private.identity_signup_intents x
    where lower(x.email)=lower(p_payload->>'email') order by x.updated_at desc limit 1;
    return coalesce(r,'null'::jsonb);
  elsif p_action = 'find_user' then
    select jsonb_build_object('id',x.id) into r from private.identity_signup_intents x
    where x.completed_user_id=(p_payload->>'user_id')::uuid order by x.updated_at desc limit 1;
    return coalesce(r,'null'::jsonb);
  elsif p_action = 'insert_intent' then
    insert into private.identity_signup_intents(
      email,email_otp_hash,email_otp_expires_at,email_verified_at,registration_token_hash,
      legal_terms_accepted_at,legal_privacy_accepted_at,legal_content_policy_accepted_at,
      legal_age_confirmed_at,legal_policy_version,birth_date,username,display_name,
      verification_session_id,verification_stage,identity_status,id_number_hmac,id_number_last4,
      country_code,provider_reference,rejection_reason,updated_at,expires_at,completed_user_id
    ) values (
      p_payload->>'email',p_payload->>'email_otp_hash',nullif(p_payload->>'email_otp_expires_at','')::timestamptz,
      null,p_payload->>'registration_token_hash',nullif(p_payload->>'legal_terms_accepted_at','')::timestamptz,
      nullif(p_payload->>'legal_privacy_accepted_at','')::timestamptz,nullif(p_payload->>'legal_content_policy_accepted_at','')::timestamptz,
      nullif(p_payload->>'legal_age_confirmed_at','')::timestamptz,p_payload->>'legal_policy_version',
      (p_payload->>'birth_date')::date,nullif(p_payload->>'username',''),nullif(p_payload->>'display_name',''),
      nullif(p_payload->>'verification_session_id','')::uuid,p_payload->>'verification_stage',p_payload->>'identity_status',
      null,null,p_payload->>'country_code',nullif(p_payload->>'provider_reference',''),nullif(p_payload->>'rejection_reason',''),
      (p_payload->>'updated_at')::timestamptz,(p_payload->>'expires_at')::timestamptz,nullif(p_payload->>'completed_user_id','')::uuid
    ) returning to_jsonb(identity_signup_intents) into r;
    return r;
  elsif p_action = 'update_intent' then
    iid=(p_payload->>'id')::uuid;
    update private.identity_signup_intents x set
      email=coalesce(p_payload->>'email',x.email),
      email_otp_hash=case when p_payload ? 'email_otp_hash' then nullif(p_payload->>'email_otp_hash','') else x.email_otp_hash end,
      email_otp_expires_at=case when p_payload ? 'email_otp_expires_at' then nullif(p_payload->>'email_otp_expires_at','')::timestamptz else x.email_otp_expires_at end,
      email_verified_at=case when p_payload ? 'email_verified_at' then nullif(p_payload->>'email_verified_at','')::timestamptz else x.email_verified_at end,
      birth_date=coalesce(nullif(p_payload->>'birth_date','')::date,x.birth_date),
      username=case when p_payload ? 'username' then nullif(p_payload->>'username','') else x.username end,
      display_name=case when p_payload ? 'display_name' then nullif(p_payload->>'display_name','') else x.display_name end,
      verification_session_id=case when p_payload ? 'verification_session_id' then nullif(p_payload->>'verification_session_id','')::uuid else x.verification_session_id end,
      verification_stage=coalesce(p_payload->>'verification_stage',x.verification_stage),
      identity_status=coalesce(p_payload->>'identity_status',x.identity_status),
      country_code=coalesce(p_payload->>'country_code',x.country_code),
      provider_reference=case when p_payload ? 'provider_reference' then nullif(p_payload->>'provider_reference','') else x.provider_reference end,
      rejection_reason=case when p_payload ? 'rejection_reason' then nullif(p_payload->>'rejection_reason','') else x.rejection_reason end,
      updated_at=coalesce(nullif(p_payload->>'updated_at','')::timestamptz,now()),
      expires_at=coalesce(nullif(p_payload->>'expires_at','')::timestamptz,x.expires_at),
      completed_user_id=case when p_payload ? 'completed_user_id' then nullif(p_payload->>'completed_user_id','')::uuid else x.completed_user_id end,
      legal_terms_accepted_at=coalesce(nullif(p_payload->>'legal_terms_accepted_at','')::timestamptz,x.legal_terms_accepted_at),
      legal_privacy_accepted_at=coalesce(nullif(p_payload->>'legal_privacy_accepted_at','')::timestamptz,x.legal_privacy_accepted_at),
      legal_content_policy_accepted_at=coalesce(nullif(p_payload->>'legal_content_policy_accepted_at','')::timestamptz,x.legal_content_policy_accepted_at),
      legal_age_confirmed_at=coalesce(nullif(p_payload->>'legal_age_confirmed_at','')::timestamptz,x.legal_age_confirmed_at),
      legal_policy_version=coalesce(p_payload->>'legal_policy_version',x.legal_policy_version),
      verified_birth_date=case when p_payload ? 'verified_birth_date' then nullif(p_payload->>'verified_birth_date','')::date else x.verified_birth_date end
    where x.id=iid returning to_jsonb(identity_signup_intents) into r;
    return coalesce(r,'null'::jsonb);
  elsif p_action='create_session' then
    insert into private.identity_verification_sessions(intent_id,user_id,token_hash,state,expires_at,started_at,updated_at)
    values((p_payload->>'intent_id')::uuid,nullif(p_payload->>'user_id','')::uuid,p_payload->>'token_hash',
      'created',(p_payload->>'expires_at')::timestamptz,(p_payload->>'started_at')::timestamptz,(p_payload->>'updated_at')::timestamptz)
    returning id into sid;
    select to_jsonb(x) into r from private.identity_verification_sessions x where x.id=sid;
    return r;
  elsif p_action='get_engine_result' then
    select to_jsonb(x) into r from private.identity_engine_results x
    where x.session_id=(p_payload->>'session_id')::uuid limit 1;
    return coalesce(r,'null'::jsonb);
  end if;
  raise exception 'IDENTITY_DB_ACTION_NOT_ALLOWED';
end;
$$;
revoke execute on function public.identity_signup_db(text,jsonb) from public,anon,authenticated;
grant execute on function public.identity_signup_db(text,jsonb) to service_role;