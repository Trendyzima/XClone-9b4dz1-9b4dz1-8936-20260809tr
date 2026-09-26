-- Reconcile the owner record after the original control-plane migration may have
-- executed before the first Auth profile existed. Only a single-profile database
-- can be auto-bound; multi-user databases require explicit owner provisioning.
do $$
declare v_count integer; v_id uuid;
begin
  select count(*) into v_count from public.profiles;
  select id into v_id from public.profiles limit 1;
  if not exists(select 1 from public.testagram_governance_owner where singleton=true)
     and v_count=1 then
    insert into public.testagram_governance_owner(singleton,user_id)
    values(true,v_id);
    insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
    values(null,'owner.bootstrap.reconciled',v_id,'Reconciled initial system owner after Auth profile creation',
      jsonb_build_object('method','single-profile-reconciliation'));
  end if;
end $$;
