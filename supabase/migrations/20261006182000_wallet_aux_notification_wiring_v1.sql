-- Wallet auxiliary notification wiring v1.
-- Covers scheduled transfers, referrals, pay-later installments, wallet splits and auto-payout schedule changes.

CREATE OR REPLACE FUNCTION private.notify_wallet_aux()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  j jsonb:=to_jsonb(new);
  uid uuid:=nullif(coalesce(j->>'user_id',j->>'from_user_id'),'')::uuid;
  recipient uuid:=nullif(j->>'to_user_id','')::uuid;
  amount numeric:=coalesce(nullif(j->>'amount','')::numeric,nullif(j->>'total_amount','')::numeric,0);
  status text:=coalesce(j->>'status','created');
  kind text;
  entity_id uuid:=nullif(j->>'id','')::uuid;
  payload jsonb;
begin
  if tg_table_name='wallet_referral_credits' then
    kind:='referral_credit';
  elsif tg_table_name='wallet_scheduled_transfers' then
    kind:='scheduled_transfer';
  elsif tg_table_name='wallet_pay_later_installments' then
    kind:='pay_later';
  elsif tg_table_name='wallet_splits' then
    kind:='wallet_split';
  elsif tg_table_name='wallet_split_recipients' then
    uid:=recipient;
    kind:='payment_received';
  elsif tg_table_name='wallet_auto_payout_schedules' then
    kind:='auto_payout_schedule';
  else
    return new;
  end if;

  if uid is not null then
    payload:=j||jsonb_build_object('amount',amount,'status',status,'action_url','/wallet');
    perform private.emit_wallet_notification(
      uid,
      case
        when kind='scheduled_transfer' and status in ('failed','cancelled') then 'payment_failed'
        when kind='scheduled_transfer' and status='completed' then 'payment_sent'
        when kind='pay_later' and status in ('failed','overdue') then 'payment_failed'
        else kind
      end,
      null,
      tg_table_name,
      entity_id,
      payload,
      'wallet-aux:'||tg_table_name||':'||coalesce(entity_id::text,'unknown')||':'||status||':'||uid::text
    );
  end if;

  if tg_table_name='wallet_scheduled_transfers' and recipient is not null and status='completed' then
    perform private.emit_wallet_notification(
      recipient,'payment_received',uid,tg_table_name,entity_id,
      j||jsonb_build_object('amount',amount,'status',status,'action_url','/wallet/history'),
      'wallet-aux:scheduled-recipient:'||coalesce(entity_id::text,'unknown')||':'||recipient::text
    );
  end if;
  return new;
end;
$function$


drop trigger if exists wallet_referral_credits_notifications on public.wallet_referral_credits;
create trigger wallet_referral_credits_notifications after insert on public.wallet_referral_credits for each row execute function private.notify_wallet_aux();

drop trigger if exists wallet_scheduled_transfers_notifications on public.wallet_scheduled_transfers;
create trigger wallet_scheduled_transfers_notifications after insert or update of status on public.wallet_scheduled_transfers for each row execute function private.notify_wallet_aux();

drop trigger if exists wallet_pay_later_notifications on public.wallet_pay_later_installments;
create trigger wallet_pay_later_notifications after insert or update of status on public.wallet_pay_later_installments for each row execute function private.notify_wallet_aux();

drop trigger if exists wallet_splits_notifications on public.wallet_splits;
create trigger wallet_splits_notifications after insert or update of status on public.wallet_splits for each row execute function private.notify_wallet_aux();

drop trigger if exists wallet_split_recipients_notifications on public.wallet_split_recipients;
create trigger wallet_split_recipients_notifications after insert on public.wallet_split_recipients for each row execute function private.notify_wallet_aux();

drop trigger if exists wallet_auto_payout_notifications on public.wallet_auto_payout_schedules;
create trigger wallet_auto_payout_notifications after insert or update of is_active,next_payout_at on public.wallet_auto_payout_schedules for each row execute function private.notify_wallet_aux();
