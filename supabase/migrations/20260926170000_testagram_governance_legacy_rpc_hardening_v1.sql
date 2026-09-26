-- Close the legacy appointment RPC so every appointment path has the same MFA gate.
create or replace function public.testagram_appoint_admin(p_user_id uuid,p_role_name text)
returns jsonb
language sql security definer set search_path=''
as $$
  select public.testagram_appoint_admin_v2(p_user_id,p_role_name,null,null);
$$;
