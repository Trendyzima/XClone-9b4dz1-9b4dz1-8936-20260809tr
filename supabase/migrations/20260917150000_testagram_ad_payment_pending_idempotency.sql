-- Prevent concurrent Create Ad payment requests from creating multiple pending
-- M-Pesa STK pushes for the same advertiser/campaign.
create unique index if not exists testagram_ad_payments_pending_campaign_user_key
  on public.testagram_ad_payments (campaign_id, user_id)
  where status = 'pending';
