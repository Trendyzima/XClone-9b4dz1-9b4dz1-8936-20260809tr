-- 100k-capacity hardening: make high-frequency lookup/feed/delivery paths index-addressable.
-- Non-destructive: indexes only; no rows, tables, media, auth records, or existing contracts are changed.

create index if not exists conversations_participant_1_idx
  on public.conversations (participant_1);

create index if not exists conversations_participant_2_idx
  on public.conversations (participant_2);

create index if not exists posts_home_active_idx
  on public.posts (community_id, created_at desc, id desc)
  where deleted_at is null;

create index if not exists notification_delivery_outbox_pending_idx
  on public.notification_delivery_outbox (status, next_attempt_at, created_at)
  where status = 'pending';

create index if not exists notification_push_deliveries_token_idx
  on public.notification_push_deliveries (push_token_id, created_at desc);
