-- Harden local + federated interaction persistence boundaries.
create table if not exists public.federated_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  object_uri text not null,
  content text not null,
  activity_uri text,
  delivery_state text not null default 'pending',
  delivery_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.federated_quotes enable row level security;
drop policy if exists federated_quotes_owner on public.federated_quotes;
create policy federated_quotes_owner on public.federated_quotes for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select,insert,update,delete on public.federated_quotes to authenticated;
create index if not exists federated_quotes_user_object_idx on public.federated_quotes(user_id, object_uri, created_at desc);

alter table public.federated_reactions drop constraint if exists federated_reactions_reaction_type_check;
alter table public.federated_reactions add constraint federated_reactions_reaction_type_check
check (reaction_type in ('like','boost','reply','reaction'));

alter table public.posts add column if not exists quoted_post_id uuid references public.posts(id) on delete set null;
create index if not exists posts_quoted_post_idx on public.posts(quoted_post_id);

insert into public.capability_registry(name,version,access,readonly,description,enabled) values
('testagram.posts.like',2,'authenticated',false,'Toggle authenticated user local like.',true),
('testagram.posts.like.state',2,'authenticated',true,'Read authenticated user local like state.',true),
('testagram.posts.repost',2,'authenticated',false,'Toggle authenticated user local repost.',true),
('testagram.posts.repost.state',2,'authenticated',true,'Read authenticated user local repost state.',true),
('testagram.posts.reaction.set',1,'authenticated',false,'Set or clear one local emoji reaction.',true),
('testagram.posts.reaction.list',1,'authenticated',true,'List local emoji reactions and counts.',true),
('testagram.posts.quote',1,'authenticated',false,'Record a local quote-post relation.',true),
('testagram.replies.create',2,'authenticated',false,'Create a durable local reply.',true),
('testagram.replies.list',2,'authenticated',true,'List durable local replies.',true)
on conflict(name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,description=excluded.description,enabled=true,updated_at=now();

create or replace function public.testagram_set_local_reaction(p_post_id uuid,p_emoji text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_user uuid := (select auth.uid()); v_emoji text := nullif(btrim(coalesce(p_emoji,'')),'');
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 if v_emoji is null or length(v_emoji)>32 then raise exception using errcode='22023',message='Valid emoji is required'; end if;
 if not exists(select 1 from public.posts where id=p_post_id and deleted_at is null) then raise exception using errcode='P0002',message='Post not found'; end if;
 delete from public.post_reactions where post_id=p_post_id and user_id=v_user;
 insert into public.post_reactions(post_id,user_id,emoji) values(p_post_id,v_user,v_emoji);
 return jsonb_build_object('post_id',p_post_id,'emoji',v_emoji,'active',true);
end $$;

create or replace function public.testagram_clear_local_reaction(p_post_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_user uuid := (select auth.uid());
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 delete from public.post_reactions where post_id=p_post_id and user_id=v_user;
 return jsonb_build_object('post_id',p_post_id,'active',false);
end $$;

create or replace function public.testagram_local_reaction_state(p_post_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
 select jsonb_build_object(
  'post_id',p_post_id,
  'emoji',(select r.emoji from public.post_reactions r where r.post_id=p_post_id and r.user_id=(select auth.uid()) limit 1),
  'counts',coalesce((select jsonb_object_agg(x.emoji,x.cnt) from
    (select emoji,count(*)::bigint cnt from public.post_reactions where post_id=p_post_id group by emoji) x),'{}'::jsonb)
 );
$$;

create or replace function public.testagram_record_local_quote(p_post_id uuid,p_quoted_post_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_user uuid := (select auth.uid());
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 if p_post_id=p_quoted_post_id then raise exception using errcode='22023',message='A post cannot quote itself'; end if;
 if not exists(select 1 from public.posts where id=p_post_id and user_id=v_user and deleted_at is null) then raise exception using errcode='42501',message='Post ownership required'; end if;
 if not exists(select 1 from public.posts where id=p_quoted_post_id and deleted_at is null) then raise exception using errcode='P0002',message='Quoted post not found'; end if;
 update public.posts set quoted_post_id=p_quoted_post_id,updated_at=now() where id=p_post_id;
 return jsonb_build_object('post_id',p_post_id,'quoted_post_id',p_quoted_post_id,'saved',true);
end $$;

grant execute on function public.testagram_set_local_reaction(uuid,text),public.testagram_clear_local_reaction(uuid),public.testagram_local_reaction_state(uuid),public.testagram_record_local_quote(uuid,uuid) to authenticated;
