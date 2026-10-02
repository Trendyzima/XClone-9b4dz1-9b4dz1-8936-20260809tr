-- Harden the social-graph interaction boundary.
-- Interactions may remain publicly discoverable only when their source post is
-- visible to the actor. This preserves public traceability without allowing a
-- user to interact with a private/deleted post by guessing its UUID.

create or replace function public.testagram_toggle_local_like(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_user uuid:=auth.uid(); v_active boolean; v_count bigint;
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 if not public.testagram_post_is_visible_to_viewer(p_post_id,v_user) then
   raise exception using errcode='42501',message='Post is not visible to this user';
 end if;
 select exists(select 1 from public.post_reactions where post_id=p_post_id and user_id=v_user and emoji='❤️') into v_active;
 if v_active then delete from public.post_reactions where post_id=p_post_id and user_id=v_user;
 else delete from public.post_reactions where post_id=p_post_id and user_id=v_user;
      insert into public.post_reactions(post_id,user_id,emoji) values(p_post_id,v_user,'❤️');
 end if;
 select count(*) into v_count from public.post_reactions where post_id=p_post_id and emoji='❤️';
 update public.posts set likes_count=v_count,updated_at=now() where id=p_post_id;
 return jsonb_build_object('state',jsonb_build_object('is_liked',not v_active,'likes_count',v_count));
end $$;

create or replace function public.testagram_toggle_local_repost(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_user uuid:=auth.uid(); v_active boolean; v_count bigint;
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 if not public.testagram_post_is_visible_to_viewer(p_post_id,v_user) then
   raise exception using errcode='42501',message='Post is not visible to this user';
 end if;
 select exists(select 1 from public.reposts where post_id=p_post_id and user_id=v_user) into v_active;
 if v_active then delete from public.reposts where post_id=p_post_id and user_id=v_user;
 else insert into public.reposts(post_id,user_id) values(p_post_id,v_user); end if;
 select count(*) into v_count from public.reposts where post_id=p_post_id;
 update public.posts set reposts_count=v_count,updated_at=now() where id=p_post_id;
 return jsonb_build_object('state',jsonb_build_object('is_reposted',not v_active,'reposts_count',v_count));
end $$;

create or replace function public.testagram_create_local_reply(p_post_id uuid,p_content text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_user uuid:=auth.uid(); v_content text:=btrim(coalesce(p_content,'')); v_id uuid; v_count bigint;
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 if v_content='' then raise exception using errcode='22023',message='Reply content is required'; end if;
 if length(v_content)>10000 then raise exception using errcode='22023',message='Reply is too long'; end if;
 if not public.testagram_post_is_visible_to_viewer(p_post_id,v_user) then
   raise exception using errcode='42501',message='Post is not visible to this user';
 end if;
 insert into public.replies(post_id,user_id,content) values(p_post_id,v_user,v_content) returning id into v_id;
 select count(*) into v_count from public.replies where post_id=p_post_id;
 update public.posts set replies_count=v_count,updated_at=now() where id=p_post_id;
 return jsonb_build_object('reply_id',v_id,'created',true,'replies_count',v_count);
end $$;

create or replace function public.testagram_create_local_reply_v2(p_post_id uuid,p_content text,p_parent_reply_id uuid default null)
returns jsonb
language plpgsql
set search_path=public
as $$
declare v_user uuid:=auth.uid(); v_content text:=btrim(coalesce(p_content,'')); v_id uuid; v_count bigint;
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 if v_content='' then raise exception using errcode='22023',message='Reply content is required'; end if;
 if length(v_content)>10000 then raise exception using errcode='22023',message='Reply is too long'; end if;
 if not public.testagram_post_is_visible_to_viewer(p_post_id,v_user) then
   raise exception using errcode='42501',message='Post is not visible to this user';
 end if;
 if p_parent_reply_id is not null and not exists(
   select 1 from public.replies r where r.id=p_parent_reply_id and r.post_id=p_post_id
 ) then
   raise exception using errcode='22023',message='Parent reply must belong to the same post';
 end if;
 insert into public.replies(post_id,user_id,content,parent_reply_id)
 values(p_post_id,v_user,v_content,p_parent_reply_id)
 returning id into v_id;
 select count(*) into v_count from public.replies where post_id=p_post_id;
 update public.posts set replies_count=v_count,updated_at=now() where id=p_post_id;
 return jsonb_build_object('reply_id',v_id,'created',true,'replies_count',v_count,'parent_reply_id',p_parent_reply_id);
end $$;

create or replace function public.testagram_record_local_quote(p_post_id uuid,p_quoted_post_id uuid)
returns jsonb
language plpgsql
set search_path=public
as $$
declare v_user uuid:=auth.uid();
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 if p_post_id=p_quoted_post_id then raise exception using errcode='22023',message='A post cannot quote itself'; end if;
 if not exists(
   select 1 from public.posts where id=p_post_id and user_id=v_user and deleted_at is null
 ) then
   raise exception using errcode='42501',message='Post ownership required';
 end if;
 if not public.testagram_post_is_visible_to_viewer(p_quoted_post_id,v_user) then
   raise exception using errcode='42501',message='Quoted post is not visible to this user';
 end if;
 update public.posts set quoted_post_id=p_quoted_post_id,updated_at=now() where id=p_post_id;
 return jsonb_build_object('post_id',p_post_id,'quoted_post_id',p_quoted_post_id,'saved',true);
end $$;

revoke all on function public.testagram_toggle_local_like(uuid) from public;
grant execute on function public.testagram_toggle_local_like(uuid) to authenticated;
revoke all on function public.testagram_toggle_local_repost(uuid) from public;
grant execute on function public.testagram_toggle_local_repost(uuid) to authenticated;


create or replace function public.create_post_atomic(p_input jsonb)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_post_id uuid;
  v_poll_id uuid;
  v_question text;
  v_options text[];
  v_duration integer;
  v_ends_at timestamptz;
  v_community_id uuid := nullif(p_input->>'community_id','')::uuid;
  v_quoted_post_id uuid := nullif(coalesce(p_input->>'quoted_post_id',p_input->>'quote_post_id',p_input->>'quote_of_post_id'),'')::uuid;
begin
  if v_user_id is null then
    raise exception using errcode='28000', message='Authentication required';
  end if;

  if nullif(trim(coalesce(p_input->>'content',p_input->>'body','')),'') is null
     and jsonb_typeof(p_input->'poll') <> 'object'
     and nullif(p_input->>'image_url','') is null
     and nullif(p_input->>'video_url','') is null
     and coalesce(jsonb_array_length(p_input->'media_urls'),0)=0 then
    raise exception using errcode='22023', message='Post content is required';
  end if;

  if v_community_id is not null and not exists (
    select 1 from public.communities c
    where c.id=v_community_id
      and (
        c.visibility='public'
        or c.owner_id=v_user_id
        or exists (
          select 1 from public.community_members m
          where m.community_id=c.id and m.user_id=v_user_id and m.status='active'
        )
      )
  ) then
    raise exception using errcode='42501', message='You are not allowed to post in this community';
  end if;

  if v_quoted_post_id is not null
     and not public.testagram_post_is_visible_to_viewer(v_quoted_post_id,v_user_id) then
    raise exception using errcode='42501', message='Quoted post is not visible to this user';
  end if;

  insert into public.posts(
    user_id,author_id,content,image_url,video_url,is_video,
    community_id,media_urls,media_count,quoted_post_id
  )
  values(
    v_user_id,v_user_id,
    coalesce(p_input->>'content',p_input->>'body',''),
    nullif(p_input->>'image_url',''),
    nullif(p_input->>'video_url',''),
    coalesce((p_input->>'is_video')::boolean,false),
    v_community_id,
    case when jsonb_typeof(p_input->'media_urls')='array'
      then array(select jsonb_array_elements_text(p_input->'media_urls'))
      else '{}'::text[] end,
    coalesce((p_input->>'media_count')::integer,
      case when jsonb_typeof(p_input->'media_urls')='array'
        then jsonb_array_length(p_input->'media_urls') else 0 end),
    v_quoted_post_id
  )
  returning id into v_post_id;

  if jsonb_typeof(p_input->'poll')='object' then
    v_question := nullif(trim(p_input->'poll'->>'question'),'');
    if v_question is null or char_length(v_question)<5 then
      raise exception using errcode='22023', message='Poll question is too short';
    end if;

    select coalesce(
      array_agg(trim(value) order by ordinality) filter(where char_length(trim(value))>0),
      '{}'::text[]
    )
    into v_options
    from jsonb_array_elements_text(coalesce(p_input->'poll'->'options','[]'::jsonb))
      with ordinality;

    if coalesce(array_length(v_options,1),0)<2 or coalesce(array_length(v_options,1),0)>8 then
      raise exception using errcode='22023', message='A poll needs 2 to 8 answers';
    end if;

    v_duration := greatest(1,least(coalesce((p_input->'poll'->>'duration_minutes')::integer,1440),10080));
    v_ends_at := now()+make_interval(mins=>v_duration);

    insert into public.polls(
      post_id,creator_id,question,description,allow_multiple,visibility,ends_at
    )
    values(
      v_post_id,v_user_id,v_question,null,
      coalesce((p_input->'poll'->>'multiple_choice')::boolean,false),
      'public',v_ends_at
    )
    returning id into v_poll_id;

    insert into public.poll_options(poll_id,label,position)
    select v_poll_id,trim(value),(ordinality::integer-1)::smallint
    from unnest(v_options) with ordinality as x(value,ordinality);
  end if;

  return jsonb_build_object('post_id',v_post_id,'poll_id',v_poll_id,'created',true);
end;
$function$;

revoke all on function public.create_post_atomic(jsonb) from public;
grant execute on function public.create_post_atomic(jsonb) to authenticated;
