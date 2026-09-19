revoke execute on function public.touch_user_heartbeat(text) from public, anon;
grant execute on function public.touch_user_heartbeat(text) to authenticated;
grant execute on function public.touch_user_heartbeat(text) to service_role;
