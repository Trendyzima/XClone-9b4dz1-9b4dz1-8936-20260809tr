create or replace function private.verify_identity_email_otp(p_intent_id uuid, p_code_hash text)
returns text
language plpgsql
security definer
set search_path = private, public
as $$
declare
  v_intent private.identity_signup_intents%rowtype;
begin
  select * into v_intent
  from private.identity_signup_intents
  where id = p_intent_id
  for update;

  if not found then return 'NOT_FOUND'; end if;
  if v_intent.email_verified_at is not null then return 'ALREADY_VERIFIED'; end if;
  if v_intent.email_otp_locked_until is not null and v_intent.email_otp_locked_until > now() then return 'LOCKED'; end if;
  if v_intent.email_otp_expires_at is null or v_intent.email_otp_expires_at < now() then return 'EXPIRED'; end if;

  if v_intent.email_otp_hash = p_code_hash then
    update private.identity_signup_intents
      set email_verified_at=now(),
          email_otp_hash=null,
          email_otp_expires_at=null,
          email_otp_attempts=0,
          email_otp_locked_until=null,
          updated_at=now()
    where id=p_intent_id;
    return 'VERIFIED';
  end if;

  update private.identity_signup_intents
    set email_otp_attempts = email_otp_attempts + 1,
        email_otp_locked_until = case
          when email_otp_attempts + 1 >= 5 then now() + interval '15 minutes'
          else email_otp_locked_until
        end,
        updated_at=now()
  where id=p_intent_id;

  return case when v_intent.email_otp_attempts + 1 >= 5 then 'LOCKED' else 'INVALID' end;
end;
$$;

revoke all on function private.verify_identity_email_otp(uuid,text) from public, anon, authenticated;
grant execute on function private.verify_identity_email_otp(uuid,text) to service_role;
