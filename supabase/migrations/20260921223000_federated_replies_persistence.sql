create table if not exists public.federated_replies (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 object_uri text not null,
 parent_uri text,
 content text not null,
 activity_uri text,
 delivery_state text not null default 'pending',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists federated_replies_object_idx on public.federated_replies(object_uri,created_at);
create index if not exists federated_replies_user_idx on public.federated_replies(user_id,created_at);
alter table public.federated_replies enable row level security;
drop policy if exists "Users read own federated replies" on public.federated_replies;
create policy "Users read own federated replies" on public.federated_replies for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Users insert own federated replies" on public.federated_replies;
create policy "Users insert own federated replies" on public.federated_replies for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists "Users update own federated replies" on public.federated_replies;
create policy "Users update own federated replies" on public.federated_replies for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
