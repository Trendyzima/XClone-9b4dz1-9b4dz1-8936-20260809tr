-- Reconcile the feature-complete migration with production security hardening.
-- Browser roles never receive financial ledgers or backend registries.
-- Messaging/call membership checks are narrowly-scoped SECURITY DEFINER helpers
-- with pinned search_path and authenticated identity binding.

create schema if not exists private;
create or replace function private.is_conversation_member(p_conversation_id uuid,p_user_id uuid)
returns boolean language sql security definer set search_path=pg_catalog,public
as $$ select p_user_id is not null and p_user_id=auth.uid() and exists(select 1 from public.conversation_members cm where cm.conversation_id=p_conversation_id and cm.user_id=p_user_id and cm.left_at is null); $$;
create or replace function private.is_call_participant(p_call_id uuid,p_user_id uuid)
returns boolean language sql security definer set search_path=pg_catalog,public
as $$ select p_user_id is not null and p_user_id=auth.uid() and exists(select 1 from public.call_participants cp where cp.call_id=p_call_id and cp.user_id=p_user_id); $$;
revoke all on function private.is_conversation_member(uuid,uuid) from public;
revoke all on function private.is_call_participant(uuid,uuid) from public;
grant execute on function private.is_conversation_member(uuid,uuid) to authenticated;
grant execute on function private.is_call_participant(uuid,uuid) to authenticated;

drop policy if exists backend_registry_service on public.backend_change_registry;
create policy backend_registry_service on public.backend_change_registry for all to service_role using(true) with check(true);
drop policy if exists frontend_contract_service on public.frontend_backend_contract;
create policy frontend_contract_service on public.frontend_backend_contract for all to service_role using(true) with check(true);

alter table public.wallets enable row level security;
alter table public.transactions enable row level security;
revoke all on public.wallets from anon,authenticated;
revoke all on public.transactions from anon,authenticated;
grant all on public.wallets to service_role;
grant all on public.transactions to service_role;
drop policy if exists wallets_owner on public.wallets;
drop policy if exists wallets_service_role_only on public.wallets;
create policy wallets_service_role_only on public.wallets for all to service_role using(true) with check(true);
drop policy if exists transactions_service_role_only on public.transactions;
create policy transactions_service_role_only on public.transactions for all to service_role using(true) with check(true);

alter view public.service_health_24h set (security_invoker=true);
revoke all on public.service_health_24h from anon,authenticated;
grant select on public.service_health_24h to service_role;
revoke all on public.service_metrics from anon,authenticated;
grant select on public.service_metrics to service_role;

do $$ begin
 if exists(select 1 from public.backend_change_registry where status='active' and (action_key is null or reverse_key is null or action_key=reverse_key)) then raise exception 'invalid active backend action/reverse key'; end if;
 if exists(select 1 from public.frontend_backend_contract where read_action_key=read_reverse_key or (write_action_key is not null and write_action_key=write_reverse_key)) then raise exception 'invalid frontend contract action/reverse key'; end if;
end $$;
