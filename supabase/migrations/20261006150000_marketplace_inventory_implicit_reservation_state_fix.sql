-- Marketplace inventory reservation state finalization.
-- The legacy six-argument checkout wrapper delegates to the reservation-aware
-- checkout. Its implicit reservation must use the table's canonical 'held'
-- state, never the retired 'reserved' state.
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='place_marketplace_order'
    and pg_get_function_identity_arguments(p.oid)='p_product_id uuid, p_quantity integer, p_idempotency_key text, p_delivery_mode text, p_delivery_address text, p_delivery_note text, p_reservation_key text';
  if src is null then raise exception 'FUNCTION_NOT_FOUND: place_marketplace_order'; end if;
  src:=replace(src, '''reserved'',now()+interval ''5 minutes''', '''held'',now()+interval ''5 minutes''');
  src:=replace(src, '''reserved'',expires_at', '''held'',expires_at');
  execute src;
end $$;
revoke all on function public.place_marketplace_order(uuid,integer,text,text,text,text) from public,anon;
grant execute on function public.place_marketplace_order(uuid,integer,text,text,text,text) to authenticated;