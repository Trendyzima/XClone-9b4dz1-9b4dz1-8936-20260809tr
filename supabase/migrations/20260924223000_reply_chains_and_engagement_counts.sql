alter table public.replies add column if not exists parent_reply_id uuid references public.replies(id) on delete cascade;
alter table public.posts add column if not exists quotes_count bigint not null default 0;

create index if not exists replies_post_created_idx on public.replies(post_id, created_at desc);
create index if not exists replies_parent_created_idx on public.replies(parent_reply_id, created_at asc);

create or replace function public.sync_post_engagement_counts()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  target_post uuid;
begin
  target_post := coalesce(new.post_id, old.post_id);
  if target_post is null then return coalesce(new, old); end if;
  update public.posts p set
    likes_count = (select count(*) from public.post_reactions r where r.post_id=target_post and r.emoji='❤️'),
    reposts_count = (select count(*) from public.reposts r where r.post_id=target_post),
    replies_count = (select count(*) from public.replies r where r.post_id=target_post),
    quotes_count = (select count(*) from public.posts q where q.quoted_post_id=target_post and q.deleted_at is null),
    updated_at = now()
  where p.id=target_post;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_sync_post_reactions_count on public.post_reactions;
create trigger trg_sync_post_reactions_count after insert or delete or update of post_id, emoji on public.post_reactions
for each row execute function public.sync_post_engagement_counts();

drop trigger if exists trg_sync_post_reposts_count on public.reposts;
create trigger trg_sync_post_reposts_count after insert or delete or update of post_id on public.reposts
for each row execute function public.sync_post_engagement_counts();

drop trigger if exists trg_sync_post_replies_count on public.replies;
create trigger trg_sync_post_replies_count after insert or delete or update of post_id on public.replies
for each row execute function public.sync_post_engagement_counts();

create or replace function public.sync_quoted_post_count()
returns trigger language plpgsql security invoker set search_path = public as $$
declare target_post uuid;
begin
  target_post := coalesce(new.quoted_post_id, old.quoted_post_id);
  if target_post is null then return coalesce(new, old); end if;
  update public.posts p set quotes_count=(select count(*) from public.posts q where q.quoted_post_id=target_post and q.deleted_at is null), updated_at=now() where p.id=target_post;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_sync_quoted_post_count on public.posts;
create trigger trg_sync_quoted_post_count after insert or delete or update of quoted_post_id, deleted_at on public.posts
for each row execute function public.sync_quoted_post_count();

update public.posts p set
 likes_count=(select count(*) from public.post_reactions r where r.post_id=p.id and r.emoji='❤️'),
 reposts_count=(select count(*) from public.reposts r where r.post_id=p.id),
 replies_count=(select count(*) from public.replies r where r.post_id=p.id),
 quotes_count=(select count(*) from public.posts q where q.quoted_post_id=p.id and q.deleted_at is null);