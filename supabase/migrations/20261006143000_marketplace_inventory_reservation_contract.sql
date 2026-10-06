-- Marketplace inventory reservation status contract hardening.
-- The table contract uses held -> committed -> released/expired.
-- Older function bodies used reserved/consumed, which can never satisfy the
-- production CHECK constraint and breaks the reservation/checkout path.

do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='expire_marketplace_inventory_reservations'
    and pg_get_function_identity_arguments(p.oid)='';
  if src is null then raise exception 'FUNCTION_NOT_FOUND: expire_marketplace_inventory_reservations'; end if;
  src:=replace(src, 'where status=''reserved'' and expires_at<=now()', 'where status=''held'' and expires_at<=now()');
  execute src;

  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='reserve_marketplace_inventory'
    and pg_get_function_identity_arguments(p.oid)='p_product_id uuid, p_quantity integer, p_reservation_key text, p_ttl_seconds integer';
  if src is null then raise exception 'FUNCTION_NOT_FOUND: reserve_marketplace_inventory'; end if;
  src:=replace(src, 'r.status=''reserved''', 'r.status=''held''');
  src:=replace(src, 'r.status=''consumed''', 'r.status=''committed''');
  src:=replace(src, '''reserved'',expires_at', '''held'',expires_at');
  execute src;

  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='place_marketplace_order'
    and pg_get_function_identity_arguments(p.oid)='p_product_id uuid, p_quantity integer, p_idempotency_key text, p_delivery_mode text, p_delivery_address text, p_delivery_note text, p_reservation_key text';
  if src is null then raise exception 'FUNCTION_NOT_FOUND: place_marketplace_order'; end if;
  src:=replace(src, 'r.status<>''reserved''', 'r.status<>''held''');
  src:=replace(src, 'status=''reserved''', 'status=''held''');
  src:=replace(src, 'status=''consumed''', 'status=''committed''');
  execute src;
end $$;

-- Keep direct execution limited to signed-in application users.
revoke all on function public.reserve_marketplace_inventory(uuid,integer,text,integer) from public, anon;
grant execute on function public.reserve_marketplace_inventory(uuid,integer,text,integer) to authenticated;
revoke all on function public.place_marketplace_order(uuid,integer,text,text,text,text,text) from public, anon;
grant execute on function public.place_marketplace_order(uuid,integer,text,text,text,text,text) to authenticated;
