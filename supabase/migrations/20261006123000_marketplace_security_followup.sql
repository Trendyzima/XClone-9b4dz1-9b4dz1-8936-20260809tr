begin;

create or replace function public.guard_marketplace_order_status()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if tg_op='UPDATE' and new.product_id is not null
    and current_setting('testagram.marketplace_transition',true)<>'1'
    and (
      old.status is distinct from new.status or
      old.buyer_id is distinct from new.buyer_id or old.seller_id is distinct from new.seller_id or
      old.product_id is distinct from new.product_id or old.quantity is distinct from new.quantity or
      old.total_minor is distinct from new.total_minor or old.currency is distinct from new.currency or
      old.unit_price_minor is distinct from new.unit_price_minor or old.total_amount is distinct from new.total_amount or
      old.payment_method is distinct from new.payment_method or old.payment_reference is distinct from new.payment_reference or
      old.paid_at is distinct from new.paid_at or old.delivery_mode is distinct from new.delivery_mode or
      old.delivery_fee_minor is distinct from new.delivery_fee_minor or old.delivery_address is distinct from new.delivery_address or
      old.delivery_status is distinct from new.delivery_status or old.escrow_status is distinct from new.escrow_status or
      old.payment_currency is distinct from new.payment_currency or old.payment_amount_minor is distinct from new.payment_amount_minor or
      old.payment_ledger_transaction_id is distinct from new.payment_ledger_transaction_id or
      old.seller_payout_ledger_transaction_id is distinct from new.seller_payout_ledger_transaction_id or
      old.marketplace_idempotency_key is distinct from new.marketplace_idempotency_key or
      old.cancelled_at is distinct from new.cancelled_at or old.cancellation_reason is distinct from new.cancellation_reason
    ) then
   raise exception 'MARKETPLACE_FINANCIAL_FIELDS_RPC_REQUIRED';
 end if;
 return new;
end $$;

revoke all on function public.guard_marketplace_order_status() from public,anon,authenticated;

commit;