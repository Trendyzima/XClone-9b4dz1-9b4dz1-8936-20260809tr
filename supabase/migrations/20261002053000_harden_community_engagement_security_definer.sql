-- Community engagement writes must be atomic even when the acting user does not own the parent post.
-- The functions validate auth.uid() themselves, then perform the counter update with
-- definer privileges so RLS on the parent post cannot roll back a valid reaction/repost/reply.
create or replace function public.testagram_toggle_local_like(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_active boolean; v_count bigint;
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 if not exists(select 1 from public.posts where id=p_post_id and deleted_at is null) then raise exception using errcode='P0002',message='Post not found'; end if;
 select exists(select 1 from public.post_reactions where post_id=p_post_id and user_id=v_user and emoji='❤️') into v_active;
 if v_active then delete from public.post_reactions where post_id=p_post_id and user_id=v_user;
 else delete from public.post_reactions where post_id=p_post_id and user_id=v_user; insert into public.post_reactions(post_id,user_id,emoji) values(p_post_id,v_user,'❤️'); end if;
 select count(*) into v_count from public.post_reactions where post_id=p_post_id and emoji='❤️';
 update public.posts set likes_count=v_count,updated_at=now() where id=p_post_id;
 return jsonb_build_object('state',jsonb_build_object('is_liked',not v_active,'likes_count',v_count));
end $$;

create or replace function public.testagram_toggle_local_repost(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_active boolean; v_count bigint;
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 if not exists(select 1 from public.posts where id=p_post_id and deleted_at is null) then raise exception using errcode='P0002',message='Post not found'; end if;
 select exists(select 1 from public.reposts where post_id=p_post_id and user_id=v_user) into v_active;
 if v_active then delete from public.reposts where post_id=p_post_id and user_id=v_user; else insert into public.reposts(post_id,user_id) values(p_post_id,v_user); end if;
 select count(*) into v_count from public.reposts where post_id=p_post_id;
 update public.posts set reposts_count=v_count,updated_at=now() where id=p_post_id;
 return jsonb_build_object('state',jsonb_build_object('is_reposted',not v_active,'reposts_count',v_count));
end $$;

create or replace function public.testagram_create_local_reply(p_post_id uuid,p_content text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_content text:=btrim(coalesce(p_content,'')); v_id uuid; v_count bigint;
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 if v_content='' then raise exception using errcode='22023',message='Reply content is required'; end if;
 if length(v_content)>10000 then raise exception using errcode='22023',message='Reply is too long'; end if;
 if not exists(select 1 from public.posts where id=p_post_id and deleted_at is null) then raise exception using errcode='P0002',message='Post not found'; end if;
 insert into public.replies(post_id,user_id,content) values(p_post_id,v_user,v_content) returning id into v_id;
 select count(*) into v_count from public.replies where post_id=p_post_id;
 update public.posts set replies_count=v_count,updated_at=now() where id=p_post_id;
 return jsonb_build_object('reply_id',v_id,'created',true,'replies_count',v_count);
end $$;

revoke all on function public.testagram_toggle_local_like(uuid) from public;
grant execute on function public.testagram_toggle_local_like(uuid) to authenticated;
revoke all on function public.testagram_toggle_local_repost(uuid) from public;
grant execute on function public.testagram_toggle_local_repost(uuid) to authenticated;
revoke all on function public.testagram_create_local_reply(uuid,text) from public;
grant execute on function public.testagram_create_local_reply(uuid,text) to authenticated;