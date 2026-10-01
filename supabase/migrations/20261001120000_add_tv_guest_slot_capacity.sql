alter table public.tv_guest_invites
  add column if not exists slot_number integer;

update public.tv_guest_invites
set slot_number = ranked.slot_number
from (
  select id, row_number() over (partition by stream_id order by created_at, id) as slot_number
  from public.tv_guest_invites
) ranked
where public.tv_guest_invites.id = ranked.id
  and public.tv_guest_invites.slot_number is null;

alter table public.tv_guest_invites
  alter column slot_number set not null;

alter table public.tv_guest_invites
  drop constraint if exists tv_guest_invites_slot_number_check;

alter table public.tv_guest_invites
  add constraint tv_guest_invites_slot_number_check
  check (slot_number between 1 and 6);

create unique index if not exists tv_guest_invites_stream_slot_unique
  on public.tv_guest_invites(stream_id, slot_number);
