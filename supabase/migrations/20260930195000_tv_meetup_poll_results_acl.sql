revoke execute on function public.tv_live_poll_results(uuid) from public;
revoke execute on function public.tv_live_poll_results(uuid) from anon;
grant execute on function public.tv_live_poll_results(uuid) to authenticated;
