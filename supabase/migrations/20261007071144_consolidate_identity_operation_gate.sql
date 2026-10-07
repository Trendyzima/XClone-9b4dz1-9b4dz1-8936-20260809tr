-- Consolidate onto the pre-existing two-argument identity gate so every sensitive
-- operation checks both the profile status and the approved verification record.
do $$
declare r record; d text; op text;
begin
  for r in
    select p.oid,p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosrc like '%private.require_verified_identity(auth.uid(), ''%'
  loop
    d:=pg_get_functiondef(r.oid);
    op:=case when r.proname like '%marketplace%' then 'marketplace'
             when r.proname like '%wallet%' or r.proname='p2p_wallet_transfer' then 'wallet'
             else 'sensitive_operation' end;
    d:=regexp_replace(d,'private\\.require_verified_identity\\(auth\\.uid\\(\\), ''[^'']+''\\)','private.require_verified_identity(auth.uid(), '''||op||''')','g');
    execute d;
  end loop;
end $$;

drop function if exists private.require_verified_identity(uuid);
