-- TV Studio now supports Testagram-native delivery without requiring YouTube.
-- Keep the provider enum/check constraints aligned with the control-plane values.
alter table public.live_streams
  drop constraint if exists live_streams_tv_provider_check,
  drop constraint if exists live_streams_active_provider_check;

alter table public.live_streams
  add constraint live_streams_tv_provider_check
    check (tv_provider in ('native-p2p', 'testagram', 'youtube', 'cloudflare')),
  add constraint live_streams_active_provider_check
    check (not is_live or tv_provider in ('native-p2p', 'testagram', 'youtube', 'cloudflare'));

notify pgrst, 'reload schema';
