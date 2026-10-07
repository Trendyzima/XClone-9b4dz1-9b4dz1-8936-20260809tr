-- Testagram-native identity DB bridge.
-- The verification tables remain in private; the Edge Function reaches them
-- through a service-role-only SECURITY DEFINER RPC. The private schema is
-- intentionally not exposed through PostgREST.

create or replace function public.identity_verification_db(
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $$
declare
  v_intent private.identity_signup_intents%rowtype;
  v_session private.identity_verification_sessions%rowtype;
  v_existing private.identity_verification_sessions%rowtype;
  v_token_hash text := nullif(p_payload->>'token_hash','');
  v_intent_id uuid := nullif(p_payload->>'intent_id','')::uuid;
  v_session_id uuid := nullif(p_payload->>'session_id','')::uuid;
  v_kind text := nullif(p_payload->>'kind','');
  v_path text := nullif(p_payload->>'object_path','');
  v_now timestamptz := now();
begin
  if p_action = 'get_intent' then
    select * into v_intent
    from private.identity_signup_intents
    where registration_token_hash = nullif(p_payload->>'registration_token_hash','')
    limit 1;
    if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;
    if v_intent.expires_at is not null and v_intent.expires_at < v_now then raise exception 'REGISTRATION_EXPIRED'; end if;
    if v_intent.email_verified_at is null then raise exception 'EMAIL_NOT_VERIFIED'; end if;
    return jsonb_build_object(
      'id',v_intent.id,'completed_user_id',v_intent.completed_user_id,
      'identity_status',v_intent.identity_status,'expires_at',v_intent.expires_at
    );
  elsif p_action = 'get_session' then
    select * into v_session from private.identity_verification_sessions
    where token_hash=v_token_hash limit 1;
    if not found then raise exception 'VERIFICATION_SESSION_NOT_FOUND'; end if;
    if v_session.expires_at < v_now then raise exception 'VERIFICATION_SESSION_EXPIRED'; end if;
    if v_session.state in ('approved','rejected','cancelled','expired') then raise exception 'VERIFICATION_SESSION_TERMINAL'; end if;
    return jsonb_build_object(
      'id',v_session.id,'intent_id',v_session.intent_id,'user_id',v_session.user_id,
      'state',v_session.state,'expires_at',v_session.expires_at
    );
  elsif p_action = 'find_active_session' then
    select * into v_existing from private.identity_verification_sessions
    where intent_id=v_intent_id and state in ('created','capturing','processing','under_review')
    order by created_at desc limit 1;
    if not found then return '{}'::jsonb; end if;
    return jsonb_build_object('id',v_existing.id,'state',v_existing.state,'expires_at',v_existing.expires_at);
  elsif p_action = 'create_session' then
    insert into private.identity_verification_sessions
      (intent_id,user_id,token_hash,state,expires_at,started_at,updated_at)
    values
      (v_intent_id,nullif(p_payload->>'user_id','')::uuid,v_token_hash,'created',
       v_now + interval '30 minutes',v_now,v_now)
    returning * into v_session;
    update private.identity_signup_intents
      set verification_session_id=v_session.id, verification_stage='capture',
          identity_status='pending', updated_at=v_now
      where id=v_intent_id;
    return jsonb_build_object('id',v_session.id,'state',v_session.state,'expires_at',v_session.expires_at);
  elsif p_action = 'rotate_session_token' then
    update private.identity_verification_sessions
      set token_hash=v_token_hash,updated_at=v_now
      where id=v_session_id
      returning * into v_session;
    if not found then raise exception 'VERIFICATION_SESSION_NOT_FOUND'; end if;
    return jsonb_build_object('id',v_session.id,'state',v_session.state,'expires_at',v_session.expires_at);
  elsif p_action = 'add_evidence' then
    insert into private.identity_verification_evidence
      (session_id,kind,object_path,mime_type,state)
    values
      (v_session_id,v_kind,v_path,nullif(p_payload->>'mime_type',''),'uploaded');
    update private.identity_verification_sessions set state='capturing',updated_at=v_now where id=v_session_id;
    return jsonb_build_object('ok',true);
  elsif p_action = 'mark_uploaded' then
    update private.identity_verification_evidence
      set state='uploaded',byte_size=nullif(p_payload->>'byte_size','')::bigint,
          sha256=nullif(p_payload->>'sha256','')
      where session_id=v_session_id and kind=v_kind and object_path=v_path;
    if not found then raise exception 'EVIDENCE_NOT_FOUND'; end if;
    return jsonb_build_object('ok',true);
  elsif p_action = 'list_evidence' then
    return coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at)
      from private.identity_verification_evidence e where e.session_id=v_session_id
    ),'[]'::jsonb);
  elsif p_action = 'get_engine_result' then
    return coalesce((
      select to_jsonb(r) from private.identity_engine_results r where r.session_id=v_session_id limit 1
    ),'null'::jsonb);
  elsif p_action = 'begin_processing' then
    if not exists (
      select 1 from private.identity_verification_evidence
      where session_id=v_session_id and kind='id_front'
    ) or not exists (
      select 1 from private.identity_verification_evidence
      where session_id=v_session_id and kind='id_back'
    ) or not exists (
      select 1 from private.identity_verification_evidence
      where session_id=v_session_id and kind='selfie'
    ) or not exists (
      select 1 from private.identity_verification_evidence
      where session_id=v_session_id and kind='liveness_video'
    ) then
      raise exception 'MISSING_EVIDENCE';
    end if;
    update private.identity_verification_sessions set state='processing',updated_at=v_now where id=v_session_id;
    update private.identity_signup_intents set verification_stage='processing',identity_status='pending',updated_at=v_now where id=v_intent_id;
    return jsonb_build_object('ok',true,'state','processing');
  elsif p_action = 'cancel' then
    update private.identity_verification_sessions
      set state='cancelled',completed_at=v_now,updated_at=v_now where id=v_session_id;
    update private.identity_signup_intents
      set verification_stage='cancelled',identity_status='rejected',
          rejection_reason='USER_CANCELLED',updated_at=v_now where id=v_intent_id;
    return jsonb_build_object('ok',true);
  else
    raise exception 'UNKNOWN_IDENTITY_DB_ACTION';
  end if;
end;
$$;

revoke all on function public.identity_verification_db(text,jsonb) from public, anon, authenticated;
grant execute on function public.identity_verification_db(text,jsonb) to service_role;
