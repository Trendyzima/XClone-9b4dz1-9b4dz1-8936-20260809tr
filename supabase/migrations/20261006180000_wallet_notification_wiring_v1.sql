-- Wallet notification wiring v1.
-- Every canonical wallet/payment state transition emits a durable notification.
-- Delivery remains asynchronous through notification_delivery_outbox.

CREATE OR REPLACE FUNCTION private.emit_wallet_notification(p_recipient_id uuid, p_kind text, p_actor_id uuid DEFAULT NULL::uuid, p_entity_type text DEFAULT 'wallet_transaction'::text, p_entity_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_unique_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_recipient_id is null then return null; end if;
  return public.create_domain_notification(
    p_recipient_id,
    p_kind,
    p_actor_id,
    null,
    p_entity_type,
    coalesce(p_payload,'{}'::jsonb),
    p_unique_key
  );
end;
$function$


CREATE OR REPLACE FUNCTION private.notify_driver_payout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.driver_user_id is null then return new; end if;
  if new.status not in ('pending','processing','completed','failed','cancelled','blocked') then return new; end if;
  perform private.emit_wallet_notification(
    new.driver_user_id,
    case when new.status='completed' then 'payout_sent'
         when new.status in ('failed','cancelled','blocked') then 'payment_failed'
         else 'payout_pending' end,
    null,'driver_payout',new.id,
    jsonb_build_object(
      'driver_payout_id',new.id,'ride_id',new.ride_id,
      'amount',coalesce(new.payable_amount_minor,0)/100.0,
      'amount_minor',new.payable_amount_minor,'currency',upper(coalesce(new.currency,'KES')),
      'status',new.status,'provider',new.provider,'failure_reason',new.failure_reason,
      'action_url','/wallet/history'
    ),
    'driver-payout:'||new.id::text||':'||new.status
  );
  return new;
end;
$function$


CREATE OR REPLACE FUNCTION private.notify_mpesa_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  key text;
  payload jsonb;
begin
  if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.user_id is null then return new; end if;
  if new.wallet_transaction_id is not null then return new; end if;
  if new.status not in ('completed','failed','cancelled') then return new; end if;

  key := 'mpesa-payment:'||new.id::text||':'||new.status;
  payload := jsonb_build_object(
    'mpesa_payment_id',new.id,'amount',coalesce(new.wallet_amount,new.amount_kes,0),
    'amount_kes',new.amount_kes,'currency',coalesce(new.wallet_currency,'KES'),
    'receipt',new.receipt_number,'checkout_request_id',new.checkout_request_id,
    'reason',new.result_description,'action_url','/wallet/mpesa'
  );

  perform private.emit_wallet_notification(
    new.user_id,
    case when new.status='completed' then 'deposit_confirmed' else 'payment_failed' end,
    null,'mpesa_payment',new.id,
    payload || jsonb_build_object(
      'title',case when new.status='completed' then 'M-Pesa deposit confirmed' else 'M-Pesa payment failed' end,
      'body',case when new.status='completed'
        then 'Your M-Pesa wallet deposit has been confirmed.'
        else 'Your M-Pesa wallet payment failed. '||coalesce(new.result_description,'Please try again.') end
    ),
    key
  );
  return new;
end;
$function$


CREATE OR REPLACE FUNCTION private.notify_payout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  amount numeric := coalesce(new.amount_minor,0)/100.0;
  kind text;
begin
  if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.user_id is null then return new; end if;
  if new.status not in ('pending','processing','completed','failed','cancelled','reversed') then return new; end if;

  kind := case
    when new.status in ('failed','cancelled','reversed') then 'payment_failed'
    when new.status='completed' then 'payout_sent'
    else 'payout_pending'
  end;

  perform private.emit_wallet_notification(
    new.user_id,kind,null,'payout',new.id,
    jsonb_build_object(
      'payout_id',new.id,'amount',amount,'amount_minor',new.amount_minor,
      'currency',upper(coalesce(new.currency,'KES')),'status',new.status,
      'provider',new.provider,'provider_reference',new.provider_reference,
      'action_url','/wallet/history',
      'title',case kind when 'payout_sent' then 'Payout sent'
        when 'payment_failed' then 'Payout failed' else 'Payout pending' end,
      'body',case kind when 'payout_sent'
        then 'Your payout of '||to_char(amount,'FM999999990.00')||' '||upper(coalesce(new.currency,'KES'))||' has been completed.'
        when 'payment_failed'
        then 'Your payout of '||to_char(amount,'FM999999990.00')||' '||upper(coalesce(new.currency,'KES'))||' failed.'
        else 'Your payout request is being processed.' end
    ),
    'payout:'||new.id::text||':'||new.status
  );
  return new;
end;
$function$


CREATE OR REPLACE FUNCTION private.notify_reward_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare kind text := case when new.reward_type='daily_streak' then 'streak_milestone' else 'reward_received' end;
begin
  if new.user_id is null then return new; end if;
  perform private.emit_wallet_notification(
    new.user_id,kind,null,'reward_event',new.id,
    jsonb_build_object(
      'reward_event_id',new.id,'reward_type',new.reward_type,
      'amount_minor',new.amount_minor,'currency',new.currency,'source',new.source,
      'streak_day',case when new.reward_type='daily_streak' then
        (select streak_day from public.daily_rewards where user_id=new.user_id) else null end,
      'action_url','/wallet',
      'title',case when kind='streak_milestone' then 'Streak reward received' else 'Reward received' end,
      'body','You received a wallet reward of '||to_char(coalesce(new.amount_minor,0)/100.0,'FM999999990.00')||' '||coalesce(new.currency,'CREDITS')||'.'
    ),
    'reward:'||new.id::text
  );
  return new;
end;
$function$


CREATE OR REPLACE FUNCTION private.notify_savings_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.user_id is null or coalesce(new.amount,0)<=0 then return new; end if;
  perform private.emit_wallet_notification(
    new.user_id,'savings_activity',null,'savings_ledger',new.id,
    jsonb_build_object(
      'savings_ledger_id',new.id,'amount',new.amount,'direction',new.direction,
      'balance_after',new.balance_after,'action_url','/wallet/savings',
      'title','Savings updated',
      'body','Your savings balance was updated by '||to_char(new.amount,'FM999999990.00')||' '||coalesce((new.metadata->>'currency'),'KES')||'.'
    ),
    'savings-ledger:'||new.id::text
  );
  return new;
end;
$function$


CREATE OR REPLACE FUNCTION private.notify_wallet_risk()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.user_id is null or new.decision not in ('block','review') then return new; end if;
  perform private.emit_wallet_notification(
    new.user_id,'wallet_security_alert',null,'wallet_risk_event',new.id,
    jsonb_build_object(
      'risk_event_id',new.id,'operation',new.operation,'amount',new.amount,
      'currency',new.currency,'decision',new.decision,'risk_score',new.risk_score,
      'reason_codes',new.reason_codes,'action_url','/wallet/security',
      'title','Wallet security alert',
      'body',case when new.decision='block'
        then 'A wallet transaction was blocked by Testagram security controls.'
        else 'A wallet transaction needs additional security review.' end
    ),
    'wallet-risk:'||new.id::text
  );
  return new;
end;
$function$


CREATE OR REPLACE FUNCTION private.notify_wallet_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := nullif(new.user_id,'')::uuid;
  counterparty uuid := nullif(new.counterparty_user_id,'')::uuid;
  kind text;
  amount numeric := abs(coalesce(new.amount,0));
  currency text := upper(coalesce(new.currency,'KES'));
  payload jsonb;
  key text;
begin
  if uid is null or amount <= 0 then return new; end if;

  if tg_op='UPDATE' and new.status is not distinct from old.status
     and new.direction is not distinct from old.direction
     and new.kind is not distinct from old.kind
     and new.counterparty_user_id is not distinct from old.counterparty_user_id then
    return new;
  end if;

  payload := jsonb_build_object(
    'transaction_id',new.id,
    'amount',amount,
    'currency',currency,
    'direction',new.direction,
    'status',new.status,
    'kind',coalesce(new.kind,new.type),
    'provider',new.provider,
    'reference',new.reference,
    'provider_reference',new.provider_reference,
    'description',new.description,
    'balance_after',new.balance_after,
    'action_url','/wallet/history'
  );
  key := 'wallet-tx:'||new.id::text||':'||coalesce(new.status,'unknown');

  if new.status in ('failed','cancelled','reversed') then
    perform private.emit_wallet_notification(
      uid,'payment_failed',null,'wallet_transaction',new.id,
      payload || jsonb_build_object('title','Wallet transaction failed',
        'body','Your wallet transaction of '||to_char(amount,'FM999999990.00')||' '||currency||' was '||new.status||'.'),
      key
    );
    return new;
  end if;

  if new.status <> 'completed' then return new; end if;

  if lower(coalesce(new.kind,new.type,'')) in ('p2p_transfer','wallet_transfer','transfer') then
    if lower(coalesce(new.direction,'')) in ('out','debit') then
      perform private.emit_wallet_notification(
        uid,'payment_sent',null,'wallet_transaction',new.id,
        payload || jsonb_build_object('title','Payment sent',
          'body','You sent '||to_char(amount,'FM999999990.00')||' '||currency||'.'),
        key||':sender'
      );
      if counterparty is not null and counterparty<>uid then
        perform private.emit_wallet_notification(
          counterparty,'payment_received',uid,'wallet_transaction',new.id,
          payload || jsonb_build_object('title','Money received',
            'body','You received '||to_char(amount,'FM999999990.00')||' '||currency||' from another Testagram user.'),
          key||':recipient'
        );
      end if;
    elsif lower(coalesce(new.direction,'')) in ('in','credit') then
      perform private.emit_wallet_notification(
        uid,'payment_received',counterparty,'wallet_transaction',new.id,
        payload || jsonb_build_object('title','Money received',
          'body','You received '||to_char(amount,'FM999999990.00')||' '||currency||'.'),
        key||':recipient-credit'
      );
    end if;
    return new;
  end if;

  if lower(coalesce(new.direction,'')) in ('in','credit') then
    if lower(coalesce(new.provider,'')) in ('mpesa','mpesa_c2b','mpesa_stk','pesapal','paypal') then
      kind := 'deposit_confirmed';
    elsif lower(coalesce(new.kind,new.type,'')) ~ '(creator|earning|tip|reward|referral|marketplace_sale|delivery)' then
      kind := 'tip_received';
    else
      kind := 'wallet_credit';
    end if;
  else
    if lower(coalesce(new.provider,'')) in ('mpesa_b2c','mpesa_withdrawal')
       or lower(coalesce(new.kind,new.type,'')) ~ '(withdraw|payout)' then
      kind := 'payout_sent';
    else
      kind := 'payment_success';
    end if;
  end if;

  perform private.emit_wallet_notification(
    uid,kind,null,'wallet_transaction',new.id,
    payload || jsonb_build_object(
      'title',case kind
        when 'deposit_confirmed' then 'Wallet deposit confirmed'
        when 'payout_sent' then 'Payout sent'
        when 'tip_received' then 'Wallet earnings received'
        when 'wallet_credit' then 'Wallet credited'
        else 'Payment successful' end,
      'body',case kind
        when 'deposit_confirmed' then 'Your deposit of '||to_char(amount,'FM999999990.00')||' '||currency||' has been confirmed.'
        when 'payout_sent' then 'Your payout of '||to_char(amount,'FM999999990.00')||' '||currency||' has been completed.'
        when 'tip_received' then 'You received '||to_char(amount,'FM999999990.00')||' '||currency||' in your Testagram wallet.'
        when 'wallet_credit' then 'Your wallet was credited with '||to_char(amount,'FM999999990.00')||' '||currency||'.'
        else 'Your payment of '||to_char(amount,'FM999999990.00')||' '||currency||' was completed.' end
    ),
    key
  );
  return new;
exception when others then
  raise;
end;
$function$


drop trigger if exists wallet_transactions_notifications on public.wallet_transactions;
create trigger wallet_transactions_notifications after insert or update of status,direction,kind,type,counterparty_user_id on public.wallet_transactions for each row execute function private.notify_wallet_transaction();

drop trigger if exists mpesa_payments_notifications on public.mpesa_payments;
create trigger mpesa_payments_notifications after insert or update of status,wallet_transaction_id on public.mpesa_payments for each row execute function private.notify_mpesa_payment();

drop trigger if exists payouts_notifications on public.payouts;
create trigger payouts_notifications after insert or update of status on public.payouts for each row execute function private.notify_payout();

drop trigger if exists driver_payouts_notifications on public.driver_payouts;
create trigger driver_payouts_notifications after insert or update of status on public.driver_payouts for each row execute function private.notify_driver_payout();

drop trigger if exists wallet_risk_notifications on public.wallet_risk_events;
create trigger wallet_risk_notifications after insert on public.wallet_risk_events for each row execute function private.notify_wallet_risk();

drop trigger if exists wallet_savings_notifications on public.wallet_savings_ledger;
create trigger wallet_savings_notifications after insert on public.wallet_savings_ledger for each row execute function private.notify_savings_ledger();

drop trigger if exists reward_events_notifications on public.reward_events;
create trigger reward_events_notifications after insert on public.reward_events for each row execute function private.notify_reward_event();
