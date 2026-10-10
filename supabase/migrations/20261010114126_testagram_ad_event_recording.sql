-- The edge delivery contract records events through this service-role-only RPC.
-- Keep click billing idempotent and preserve the original impression's owner.
create or replace function public.testagram_record_ad_event(
  p_impression_id text,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid;
  v_user_id uuid;
  v_created_at timestamptz;
  v_inserted integer;
begin
  if p_impression_id is null or length(p_impression_id) < 8 or length(p_impression_id) > 120
     or p_event_type not in ('click','viewable','video_start','video_first_quartile','video_midpoint','video_third_quartile','video_complete') then
    return false;
  end if;

  select campaign_id, user_id, created_at
    into v_campaign_id, v_user_id, v_created_at
    from public.testagram_ad_impressions
   where impression_id = p_impression_id;
  if not found then return false; end if;

  insert into public.testagram_ad_events(impression_id, event_type, user_id, metadata)
  values (p_impression_id, p_event_type, v_user_id, coalesce(p_metadata, '{}'::jsonb))
  on conflict (impression_id, event_type) do nothing;
  get diagnostics v_inserted = row_count;

  if p_event_type = 'click' and v_inserted > 0 then
    update public.testagram_ad_impressions
       set clicked = true
     where impression_id = p_impression_id and clicked = false;
    update public.testagram_ad_daily_spend
       set clicks = clicks + 1
     where campaign_id = v_campaign_id and spend_date = (v_created_at at time zone 'UTC')::date;
  end if;

  return true;
end;
$$;

revoke all on function public.testagram_record_ad_event(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.testagram_record_ad_event(text, text, jsonb) to service_role;