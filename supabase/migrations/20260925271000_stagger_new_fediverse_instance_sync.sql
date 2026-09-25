create or replace function public.process_fediverse_instance_discovery() returns integer language plpgsql security definer set search_path=public as $$
declare r record; v_json jsonb; v_count integer:=0; v_domain text; v_software text;
begin
for r in select d.id,d.request_id,h.status_code,h.content,h.error_msg,h.timed_out from public.fediverse_instance_discovery_runs d join net._http_response h on h.id=d.request_id where d.status='pending' order by d.requested_at limit 5 loop
if r.status_code between 200 and 299 and not coalesce(r.timed_out,false) and r.content is not null then
begin
v_json:=r.content::jsonb;
for v_domain,v_software in select lower(btrim(coalesce(x.value->>'domain',''))),lower(btrim(coalesce(x.value->>'softwarename','unknown'))) from jsonb_array_elements(coalesce(v_json->'data'->'nodes','[]'::jsonb)) x(value) loop
if v_domain~'^[a-z0-9][a-z0-9.-]*[a-z0-9]$' and v_domain not like '%.local' and v_domain not like 'localhost%' and length(v_domain)<=253 then
insert into public.federated_instances(domain,base_url,provider,software,public_timeline_available,discovered_at,updated_at,next_sync_at)
values(v_domain,'https://'||v_domain,'fediverse-observer',nullif(v_software,''),false,now(),now()+(random()*interval '24 hours'))
on conflict(domain) do update set base_url=excluded.base_url,provider=excluded.provider,software=coalesce(excluded.software,federated_instances.software),discovered_at=coalesce(federated_instances.discovered_at,excluded.discovered_at),updated_at=now();
v_count:=v_count+1;
end if;
end loop;
update public.fediverse_instance_discovery_runs set status='processed',processed_at=now(),discovered_count=v_count where id=r.id;
exception when others then update public.fediverse_instance_discovery_runs set status='failed',processed_at=now(),error=left(sqlerrm,2000) where id=r.id;
end;
else update public.fediverse_instance_discovery_runs set status='failed',processed_at=now(),error=left(coalesce(r.error_msg,'HTTP '||coalesce(r.status_code::text,'unknown')),2000) where id=r.id;
end if;
end loop;
return v_count;
end; $$;
update public.federated_instances set next_sync_at=now()+(random()*interval '24 hours') where provider='fediverse-observer' and last_success_at is null and next_sync_at<=now();