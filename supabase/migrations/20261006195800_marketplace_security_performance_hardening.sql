-- Performance hardening: cover marketplace foreign keys and remove duplicate inventory index.
create index if not exists credit_boost_ledger_boost_id_idx on public.credit_boost_ledger (boost_id);
create index if not exists marketplace_audit_log_actor_id_idx on public.marketplace_audit_log (actor_id);
create index if not exists marketplace_disputes_delivery_id_idx on public.marketplace_disputes (delivery_id);
create index if not exists marketplace_disputes_opened_by_idx on public.marketplace_disputes (opened_by);
create index if not exists marketplace_disputes_resolved_by_idx on public.marketplace_disputes (resolved_by);
create index if not exists marketplace_order_disputes_opened_by_idx on public.marketplace_order_disputes (opened_by);
create index if not exists marketplace_order_disputes_resolved_by_idx on public.marketplace_order_disputes (resolved_by);
create index if not exists marketplace_order_events_actor_id_idx on public.marketplace_order_events (actor_id);
create index if not exists marketplace_refunds_buyer_id_idx on public.marketplace_refunds (buyer_id);
create index if not exists marketplace_refunds_dispute_id_idx on public.marketplace_refunds (dispute_id);
create index if not exists marketplace_refunds_order_id_idx on public.marketplace_refunds (order_id);
create index if not exists marketplace_risk_events_delivery_id_idx on public.marketplace_risk_events (delivery_id);
create index if not exists marketplace_risk_events_seller_id_idx on public.marketplace_risk_events (seller_id);
create index if not exists marketplace_security_audit_delivery_id_idx on public.marketplace_security_audit (delivery_id);
drop index if exists public.marketplace_inventory_reservations_product_idx;

-- Performance hardening: evaluate auth.uid() once per statement in participant RLS.
drop policy if exists marketplace_audit_participants on public.marketplace_audit_log;
create policy marketplace_audit_participants on public.marketplace_audit_log for select to authenticated using (
  actor_id = (select auth.uid())
  or exists (select 1 from public.orders o where o.id = marketplace_audit_log.order_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid())))
  or exists (select 1 from public.marketplace_deliveries d where d.id = marketplace_audit_log.delivery_id and (d.buyer_id = (select auth.uid()) or d.seller_id = (select auth.uid()) or d.courier_id = (select auth.uid())))
);
drop policy if exists marketplace_disputes_open_participant on public.marketplace_disputes;
create policy marketplace_disputes_open_participant on public.marketplace_disputes for insert to authenticated with check (
  opened_by = (select auth.uid())
  and exists (select 1 from public.orders o where o.id = marketplace_disputes.order_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid())))
);
drop policy if exists marketplace_disputes_participants on public.marketplace_disputes;
create policy marketplace_disputes_participants on public.marketplace_disputes for select to authenticated using (
  exists (select 1 from public.orders o where o.id = marketplace_disputes.order_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid())))
);
drop policy if exists marketplace_order_events_participants on public.marketplace_order_events;
create policy marketplace_order_events_participants on public.marketplace_order_events for select to authenticated using (
  exists (select 1 from public.orders o where o.id = marketplace_order_events.order_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid())))
);
drop policy if exists marketplace_refunds_participants on public.marketplace_refunds;
create policy marketplace_refunds_participants on public.marketplace_refunds for select to authenticated using (
  buyer_id = (select auth.uid())
  or exists (select 1 from public.orders o where o.id = marketplace_refunds.order_id and o.seller_id = (select auth.uid()))
);
drop policy if exists marketplace_risk_events_participants on public.marketplace_risk_events;
create policy marketplace_risk_events_participants on public.marketplace_risk_events for select to authenticated using (
  buyer_id = (select auth.uid()) or seller_id = (select auth.uid())
);