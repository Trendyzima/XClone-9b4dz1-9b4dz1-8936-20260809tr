create or replace function public.auth_send_email_hook(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  if event is null or jsonb_typeof(event) <> 'object' then
    raise exception 'auth_send_email_hook: invalid event payload';
  end if;

  -- This function is intentionally a no-op transport hook.
  -- Do not enable it until the production email transport is connected.
  return '{}'::jsonb;
end;
$$;

revoke all on function public.auth_send_email_hook(jsonb) from public;
revoke all on function public.auth_send_email_hook(jsonb) from anon;
revoke all on function public.auth_send_email_hook(jsonb) from authenticated;
grant execute on function public.auth_send_email_hook(jsonb) to supabase_auth_admin;
