insert into public.zenad_slots (id, app_id, code, kind, floor_cpm_micros, enabled)
values ('testagram-story','testagram','story','story',50000,true)
on conflict (id) do update set code=excluded.code, kind=excluded.kind, floor_cpm_micros=excluded.floor_cpm_micros, enabled=true;

-- Ad funding is a clearing flow through the user's KES wallet. It must not inflate
-- wallet.total_deposited: the M-Pesa amount is immediately consumed by the campaign.
-- The existing wallet transaction remains auditable with accounting_purpose=ad_funding_clearing.
-- The settlement function is recreated in the live migration with that invariant.
