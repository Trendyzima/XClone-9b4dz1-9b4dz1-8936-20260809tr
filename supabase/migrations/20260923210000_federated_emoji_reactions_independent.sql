-- Make Fediverse emoji reactions a first-class independent interaction.
-- ActivityPub Like/Announce remain separate canonical interactions.
create table if not exists public.federated_emoji_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  object_uri text not null,
  emoji text not null check (char_length(emoji) between 1 and 32),
  activity_uri text,
  delivered boolean not null default false,
  delivery_state text not null default 'pending' check (delivery_state in ('pending','delivered','failed')),
  delivery_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, object_uri, emoji)
);

create index if not exists federated_emoji_reactions_object_idx
  on public.federated_emoji_reactions(object_uri, emoji);

alter table public.federated_emoji_reactions enable row level security;

drop policy if exists federated_emoji_reactions_public_read on public.federated_emoji_reactions;
create policy federated_emoji_reactions_public_read
  on public.federated_emoji_reactions for select
  to anon, authenticated using (true);

drop policy if exists federated_emoji_reactions_owner_insert on public.federated_emoji_reactions;
create policy federated_emoji_reactions_owner_insert
  on public.federated_emoji_reactions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists federated_emoji_reactions_owner_update on public.federated_emoji_reactions;
create policy federated_emoji_reactions_owner_update
  on public.federated_emoji_reactions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists federated_emoji_reactions_owner_delete on public.federated_emoji_reactions;
create policy federated_emoji_reactions_owner_delete
  on public.federated_emoji_reactions for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.federated_emoji_reactions to anon, authenticated;
grant insert, update, delete on public.federated_emoji_reactions to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='federated_emoji_reactions'
  ) then
    alter publication supabase_realtime add table public.federated_emoji_reactions;
  end if;
end $$;

-- Migrate existing Testagram-only emoji rows out of the overloaded reaction ledger.
insert into public.federated_emoji_reactions (
  user_id, object_uri, emoji, delivered, delivery_state, created_at, updated_at
)
select user_id, object_uri, content, delivered,
       case when delivered then 'delivered' else 'pending' end,
       created_at, updated_at
from public.federated_reactions
where reaction_type = 'reaction'
  and content is not null
on conflict (user_id, object_uri, emoji) do update
set delivered=excluded.delivered,
    delivery_state=excluded.delivery_state,
    updated_at=greatest(public.federated_emoji_reactions.updated_at, excluded.updated_at);

delete from public.federated_reactions where reaction_type = 'reaction';

comment on table public.federated_emoji_reactions is
  'Independent Testagram emoji reactions on remote ActivityPub objects. ActivityPub Like/Announce are stored separately.';
