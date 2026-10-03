-- Security hardening applied to production on 2026-10-03.
-- platform_control is a privileged singleton and must not be directly exposed through the Data API.
alter table public.platform_control enable row level security;
revoke all on table public.platform_control from anon;
revoke all on table public.platform_control from authenticated;

comment on table public.platform_control is
  'Privileged singleton control record. Direct Data API access is intentionally denied; privileged server-side SECURITY DEFINER routines/service_role may access it.';

-- Pin SECURITY DEFINER application functions away from pg_temp.
alter function public.testagram_toggle_local_like(uuid) set search_path = public;
alter function public.testagram_toggle_local_repost(uuid) set search_path = public;
alter function public.testagram_create_local_reply(uuid,text) set search_path = public;
alter function public.suggest_polls_for_user(integer) set search_path = public;
alter function public.sync_legacy_compat_columns() set search_path = public;
alter function public.sync_conversation_legacy_participants() set search_path = public;
alter function public.create_post_atomic_v3(jsonb) set search_path = public;
