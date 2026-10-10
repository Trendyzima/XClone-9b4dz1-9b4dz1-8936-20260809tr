-- Explicitly deny browser-role access to the private rate-limit ledger.
-- service_role bypasses RLS and is the only role with table privileges.
drop policy if exists testagram_ad_request_rate_limits_deny_client on public.testagram_ad_request_rate_limits;
create policy testagram_ad_request_rate_limits_deny_client
  on public.testagram_ad_request_rate_limits
  for all to anon, authenticated
  using (false)
  with check (false);
