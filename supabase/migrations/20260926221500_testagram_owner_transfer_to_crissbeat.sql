-- Transfer the single Testagram system-owner seat to Crissbeat's confirmed Auth account.
-- The migration fails closed if the target account or profile does not exist.
do $$
declare
  v_target uuid;
  v_previous uuid;
begin
  select u.id into v_target
  from auth.users u
  where lower(trim(u.email)) = 'nahashonnyaga794@gmail.com'
  limit 1;

  if v_target is null then
    raise exception 'Owner transfer aborted: nahashonnyaga794@gmail.com does not exist in auth.users';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_target) then
    raise exception 'Owner transfer aborted: target Auth user has no public.profiles row';
  end if;

  select o.user_id into v_previous
  from public.testagram_governance_owner o
  where o.singleton = true;

  if v_previous is distinct from v_target then
    update public.testagram_governance_owner
      set user_id = v_target, updated_at = now()
    where singleton = true;

    if not found then
      insert into public.testagram_governance_owner(singleton, user_id)
      values (true, v_target);
    end if;

    insert into public.testagram_governance_audit_log(
      actor_user_id, action, target_user_id, reason, metadata
    )
    values (
      null,
      'owner.transfer',
      v_target,
      'Transferred the Testagram system-owner seat to Crissbeat after repository fork ownership reconciliation',
      jsonb_build_object(
        'source', '20260926221500_testagram_owner_transfer_to_crissbeat',
        'previous_owner_user_id', v_previous,
        'target_email', 'nahashonnyaga794@gmail.com'
      )
    );
  end if;

  if not exists (
    select 1 from public.testagram_governance_owner
    where singleton = true and user_id = v_target
  ) then
    raise exception 'Owner transfer verification failed';
  end if;
end $$;
