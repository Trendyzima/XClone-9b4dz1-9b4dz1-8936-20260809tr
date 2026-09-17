-- Prevent duplicate billable impressions when the same ad request is retried concurrently.
create unique index if not exists testagram_ad_impressions_request_id_key
  on public.testagram_ad_impressions(request_id);
