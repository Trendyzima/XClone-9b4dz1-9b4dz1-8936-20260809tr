begin;
revoke all on function public.place_marketplace_order(uuid,integer) from public,anon,authenticated;
drop function if exists public.place_marketplace_order(uuid,integer);
commit;