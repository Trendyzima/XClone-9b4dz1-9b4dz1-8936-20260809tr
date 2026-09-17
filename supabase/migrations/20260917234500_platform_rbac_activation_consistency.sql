-- Keep role activation/deactivation and derived feature visibility consistent.
-- A feature is active only while at least one mapped platform role is active,
-- unless the platform owner is the caller (owner access is resolved directly by platform_has_feature).

create or replace function public.platform_set_role_active(
  p_assignment_id uuid,
  p_active boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role text;
begin
  if not public.is_platform_owner() then
    raise exception 'platform owner required';
  end if;

  select user_id, role_key
    into v_user_id, v_role
  from public.platform_role_assignments
  where id = p_assignment_id;

  if v_user_id is null then
    raise exception 'role assignment not found';
  end if;

  update public.platform_role_assignments
  set active = p_active,
      activated_at = case
        when p_active then coalesce(activated_at, now())
        else activated_at
      end,
      revoked_at = case
        when p_active then null
        else revoked_at
      end
  where id = p_assignment_id;

  -- Recompute every feature affected by this role. This prevents an inactive
  -- role from leaving stale capabilities visible, while preserving capabilities
  -- supplied by another independently active role.
  update public.platform_feature_assignments pfa
  set active = exists (
        select 1
        from public.platform_role_assignments pra
        join public.platform_role_features prf
          on prf.role_key = pra.role_key
        where pra.user_id = v_user_id
          and pra.active = true
          and pra.revoked_at is null
          and prf.feature_key = pfa.feature_key
      ),
      revoked_at = case
        when exists (
          select 1
          from public.platform_role_assignments pra
          join public.platform_role_features prf
            on prf.role_key = pra.role_key
          where pra.user_id = v_user_id
            and pra.active = true
            and pra.revoked_at is null
            and prf.feature_key = pfa.feature_key
        ) then null
        else pfa.revoked_at
      end
  where pfa.user_id = v_user_id
    and pfa.feature_key in (
      select feature_key
      from public.platform_role_features
      where role_key = v_role
    );
end;
$$;

create or replace function public.platform_revoke_role(p_assignment_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role text;
begin
  if not public.is_platform_owner() then
    raise exception 'platform owner required';
  end if;

  select user_id, role_key
    into v_user_id, v_role
  from public.platform_role_assignments
  where id = p_assignment_id;

  if v_user_id is null then
    raise exception 'role assignment not found';
  end if;

  update public.platform_role_assignments
  set active = false,
      revoked_at = now()
  where id = p_assignment_id;

  -- Recompute rather than blindly disabling: another active role may still
  -- legitimately provide the same feature.
  update public.platform_feature_assignments pfa
  set active = exists (
        select 1
        from public.platform_role_assignments pra
        join public.platform_role_features prf
          on prf.role_key = pra.role_key
        where pra.user_id = v_user_id
          and pra.active = true
          and pra.revoked_at is null
          and prf.feature_key = pfa.feature_key
      ),
      revoked_at = case
        when exists (
          select 1
          from public.platform_role_assignments pra
          join public.platform_role_features prf
            on prf.role_key = pra.role_key
          where pra.user_id = v_user_id
            and pra.active = true
            and pra.revoked_at is null
            and prf.feature_key = pfa.feature_key
        ) then null
        else now()
      end
  where pfa.user_id = v_user_id
    and pfa.feature_key in (
      select feature_key
      from public.platform_role_features
      where role_key = v_role
    );
end;
$$;

revoke all on function public.platform_set_role_active(uuid,boolean) from public;
revoke all on function public.platform_revoke_role(uuid) from public;
grant execute on function public.platform_set_role_active(uuid,boolean) to authenticated;
grant execute on function public.platform_revoke_role(uuid) to authenticated;

comment on function public.platform_set_role_active(uuid,boolean) is 'Owner-only role activation that recomputes derived feature visibility, preserving features supplied by other active roles.';
comment on function public.platform_revoke_role(uuid) is 'Owner-only role revocation that recomputes derived feature visibility, preserving features supplied by other active roles.';
