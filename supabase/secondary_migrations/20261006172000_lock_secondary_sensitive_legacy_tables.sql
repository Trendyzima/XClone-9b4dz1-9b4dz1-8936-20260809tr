-- Existing legacy financial/identity tables in the secondary project are retained only
-- for historical/server-side compatibility. They are not a client data plane.
-- Canonical identity, wallet, payments, ledger, payout, messaging and notification
-- state lives in the primary project.

alter table public.conversations enable row level security;
revoke all on table public.conversations from anon, authenticated;

alter table public.creator_payouts enable row level security;
revoke all on table public.creator_payouts from anon, authenticated;

alter table public.messages enable row level security;
revoke all on table public.messages from anon, authenticated;

alter table public.monetization_ledger enable row level security;
revoke all on table public.monetization_ledger from anon, authenticated;

alter table public.monetization_payouts enable row level security;
revoke all on table public.monetization_payouts from anon, authenticated;

alter table public.mpesa_payments enable row level security;
revoke all on table public.mpesa_payments from anon, authenticated;

alter table public.notification_preferences enable row level security;
revoke all on table public.notification_preferences from anon, authenticated;

alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated;

alter table public.payout_requests enable row level security;
revoke all on table public.payout_requests from anon, authenticated;

alter table public.paypal_orders enable row level security;
revoke all on table public.paypal_orders from anon, authenticated;

alter table public.pesapal_payment_orders enable row level security;
revoke all on table public.pesapal_payment_orders from anon, authenticated;

alter table public.premium_payment_orders enable row level security;
revoke all on table public.premium_payment_orders from anon, authenticated;

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;

alter table public.transactions enable row level security;
revoke all on table public.transactions from anon, authenticated;

alter table public.wallet_accounts enable row level security;
revoke all on table public.wallet_accounts from anon, authenticated;

alter table public.wallet_auto_payout_schedules enable row level security;
revoke all on table public.wallet_auto_payout_schedules from anon, authenticated;

alter table public.wallet_pay_later_installments enable row level security;
revoke all on table public.wallet_pay_later_installments from anon, authenticated;

alter table public.wallet_pay_later_plans enable row level security;
revoke all on table public.wallet_pay_later_plans from anon, authenticated;

alter table public.wallet_phone_identities enable row level security;
revoke all on table public.wallet_phone_identities from anon, authenticated;

alter table public.wallet_referral_credits enable row level security;
revoke all on table public.wallet_referral_credits from anon, authenticated;

alter table public.wallet_referrals enable row level security;
revoke all on table public.wallet_referrals from anon, authenticated;

alter table public.wallet_savings_goals enable row level security;
revoke all on table public.wallet_savings_goals from anon, authenticated;

alter table public.wallet_savings_ledger enable row level security;
revoke all on table public.wallet_savings_ledger from anon, authenticated;

alter table public.wallet_savings_pockets enable row level security;
revoke all on table public.wallet_savings_pockets from anon, authenticated;

alter table public.wallet_scheduled_transfers enable row level security;
revoke all on table public.wallet_scheduled_transfers from anon, authenticated;

alter table public.wallet_split_recipients enable row level security;
revoke all on table public.wallet_split_recipients from anon, authenticated;

alter table public.wallet_transactions enable row level security;
revoke all on table public.wallet_transactions from anon, authenticated;

alter table public.wallets enable row level security;
revoke all on table public.wallets from anon, authenticated;
