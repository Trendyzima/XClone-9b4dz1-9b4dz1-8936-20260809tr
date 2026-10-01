alter table public.tv_guest_invites
  add column if not exists muted boolean not null default false;

alter table public.tv_guest_invites
  add column if not exists blocked boolean not null default false;

create index if not exists tv_guest_invites_stream_active_slot_idx
  on public.tv_guest_invites(stream_id, slot_number)
  where used_at is null;
