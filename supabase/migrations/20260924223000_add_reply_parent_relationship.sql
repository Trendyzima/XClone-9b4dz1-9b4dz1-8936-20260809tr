alter table public.replies
  add column if not exists parent_reply_id uuid references public.replies(id) on delete cascade;

create index if not exists replies_parent_reply_id_idx
  on public.replies(parent_reply_id);
