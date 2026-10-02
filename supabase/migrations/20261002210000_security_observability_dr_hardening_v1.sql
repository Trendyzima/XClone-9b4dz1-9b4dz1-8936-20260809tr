begin;

-- Notification push configuration is backend-only.
alter table public.notification_push_config enable row level security;
revoke all on table public.notification_push_config from public, anon, authenticated;

-- Prevent newly-created public RPCs from silently becoming callable by clients.
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

commit;