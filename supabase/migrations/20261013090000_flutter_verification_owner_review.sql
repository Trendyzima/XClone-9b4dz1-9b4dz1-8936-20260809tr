-- Permit only the system owner to review generic verification_requests.
-- Users retain their own-row policy; no broad authenticated access is added.
drop policy if exists verification_requests_owner_select on public.verification_requests;
create policy verification_requests_owner_select
  on public.verification_requests for select to authenticated
  using (public.testagram_is_owner());

drop policy if exists verification_requests_owner_update on public.verification_requests;
create policy verification_requests_owner_update
  on public.verification_requests for update to authenticated
  using (public.testagram_is_owner())
  with check (public.testagram_is_owner());

-- Wallet oversight is read-only and limited to the owner. No balances or
-- transactions are exposed to ordinary authenticated users by this policy.
drop policy if exists user_wallets_platform_owner_read on public.user_wallets;
create policy user_wallets_platform_owner_read
  on public.user_wallets for select to authenticated
  using (public.testagram_is_owner());
