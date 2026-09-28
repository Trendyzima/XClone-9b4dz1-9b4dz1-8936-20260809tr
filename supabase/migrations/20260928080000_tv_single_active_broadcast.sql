-- Keep Testagram TV control-plane state idempotent: one active broadcast per broadcaster.
-- Finished recordings remain device-only; this only protects ephemeral live metadata.
with ranked as (
  select id,
         row_number() over (
           partition by user_id
           order by started_at desc, created_at desc, id desc
         ) as rn
  from public.live_streams
  where is_live = true
)
update public.live_streams s
set is_live = false,
    ended_at = coalesce(s.ended_at, now()),
    stream_url = null
from ranked r
where s.id = r.id
  and r.rn > 1;

create unique index if not exists live_streams_one_active_per_user
  on public.live_streams (user_id)
  where is_live = true;
