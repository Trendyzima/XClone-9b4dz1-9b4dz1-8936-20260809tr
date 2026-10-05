-- Phase 2/3 SECURITY DEFINER exposure hardening.
-- Backend-only callbacks, maintenance, governance administration, and internal
-- governance helpers are not direct client RPC APIs.

begin;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('public','testagram_appoint_admin','uuid,text'),
      ('public','testagram_appoint_admin_v2','uuid,text,text[],text[]'),
      ('public','testagram_bootstrap_owner','uuid'),
      ('public','testagram_invite_admin','uuid,text,text'),
      ('public','testagram_review_job_application','uuid,text,text'),
      ('public','testagram_terminate_staff','uuid,text'),
      ('public','testagram_update_admin','uuid,text,text,text'),
      ('public','testagram_require_privileged_session',''),
      ('public','testagram_governance_audit','integer'),
      ('public','testagram_search_governance_users','text,integer'),
      ('public','testagram_search_unified','text,text,integer'),
      ('public','sync_conversation_legacy_participants',''),
      ('public','sync_legacy_compat_columns',''),
      ('public','trg_auto_channel_profile',''),
      ('public','testagram_claim_ad_impression','text,text,text,uuid,uuid,uuid,bigint,jsonb,jsonb'),
      ('public','finalize_mpesa_topup','text,integer,text,text,jsonb'),
      ('public','finalize_mpesa_withdrawal','text,text,integer,text,text,jsonb'),
      ('public','finalize_testagram_ad_mpesa_payment','text,integer,text,text,numeric,jsonb,jsonb'),
      ('public','testagram_expire_stories',''),
      ('public','testagram_get_governance',''),
      ('public','testagram_list_admins',''),
      ('public','testagram_list_governance_permissions',''),
      ('public','testagram_list_job_applications','text'),
      ('public','testagram_my_staff_invitations','')
    ) as x(schema_name,function_name,identity_args)
  loop
    execute format('revoke execute on function %I.%I(%s) from authenticated',
      r.schema_name,r.function_name,r.identity_args);
  end loop;
end $$;

revoke execute on function public.testagram_claim_ad_impression(text,text,text,uuid,uuid,uuid,bigint,jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public.finalize_mpesa_topup(text,integer,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.finalize_mpesa_withdrawal(text,text,integer,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.finalize_testagram_ad_mpesa_payment(text,integer,text,text,numeric,jsonb,jsonb) from public, anon, authenticated;

revoke execute on function public.testagram_is_owner() from public, anon, authenticated;
revoke execute on function public.testagram_has_permission(text) from public, anon, authenticated;

commit;
