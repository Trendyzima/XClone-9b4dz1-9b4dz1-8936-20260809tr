-- Thread media uses the same economical Cloudflare R2 pipeline as the rest of Testagram.
alter table public.media_assets add column if not exists thread_id uuid;
create index if not exists media_assets_thread_id_idx on public.media_assets(thread_id);
alter table public.media_assets drop constraint if exists media_assets_thread_id_fkey;
alter table public.media_assets add constraint media_assets_thread_id_fkey foreign key (thread_id) references public.threads(id) on delete set null;
comment on column public.media_assets.thread_id is 'Thread attachment reference; binary bytes remain in Cloudflare R2.';
