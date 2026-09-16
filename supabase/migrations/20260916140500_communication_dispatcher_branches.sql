do $dispatch$
declare def text;
begin
 select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='capability_dispatch' and pg_get_function_identity_arguments(p.oid)='p_capability text, p_input jsonb';
 if def is null then raise exception 'capability_dispatch not found'; end if;
 if position('testagram.conversations.list' in def)=0 then
  def:=replace(def,' when ''testagram.notifications.list'' then',$cap$
 when 'testagram.conversations.list' then select public.get_conversations_with_latest(v_limit) into v; return jsonb_build_object('items',coalesce(v,'[]'::jsonb));
 when 'testagram.conversations.create' then v_id:=public.create_conversation_atomic(array(select jsonb_array_elements_text(coalesce(p_input->'member_ids','[]'::jsonb))::uuid)); return jsonb_build_object('conversation_id',v_id);
 when 'testagram.messages.list' then v_id:=(p_input->>'conversation_id')::uuid; select public.communication_list_messages(v_id,v_limit,nullif(p_input->>'cursor','')::timestamptz) into v; return v;
 when 'testagram.messages.send' then v_id:=public.send_message_idempotent((p_input->>'conversation_id')::uuid,coalesce(p_input->>'body',''),nullif(p_input->>'reply_to_message_id','')::uuid,nullif(p_input->>'shared_post_id','')::uuid,nullif(p_input->>'client_message_id','')); return jsonb_build_object('message_id',v_id);
 when 'testagram.messages.mark_read' then perform public.mark_message_status((p_input->>'message_id')::uuid,'read'); return jsonb_build_object('message_id',(p_input->>'message_id')::uuid,'read',true);
 when 'testagram.messages.react' then v_id:=(p_input->>'message_id')::uuid; if coalesce((p_input->>'remove')::boolean,false) then delete from public.message_reactions where message_id=v_id and user_id=u and reaction=p_input->>'reaction'; else insert into public.message_reactions(message_id,user_id,reaction) values(v_id,u,p_input->>'reaction') on conflict(message_id,user_id,reaction) do nothing; end if; return jsonb_build_object('message_id',v_id,'reaction',p_input->>'reaction','removed',coalesce((p_input->>'remove')::boolean,false));
 when 'testagram.calls.create' then v_id:=(p_input->>'conversation_id')::uuid; if not exists(select 1 from public.conversation_members where conversation_id=v_id and user_id=u) then raise exception 'NOT_CONVERSATION_MEMBER'; end if; insert into public.call_sessions(conversation_id,created_by,room_name,kind) values(v_id,u,coalesce(nullif(p_input->>'room_name',''),'testagram-'||replace(gen_random_uuid()::text,'-','')),coalesce(nullif(p_input->>'kind',''),'video')) returning id into v2_id; insert into public.call_participants(call_id,user_id) values(v2_id,u) on conflict do nothing; return jsonb_build_object('call_id',v2_id,'provider','livekit','room_name',(select room_name from public.call_sessions where id=v2_id));
 when 'testagram.calls.join' then v_id:=(p_input->>'call_id')::uuid; if not exists(select 1 from public.call_sessions cs join public.conversation_members cm on cm.conversation_id=cs.conversation_id where cs.id=v_id and cm.user_id=u and cs.status<>'ended') then raise exception 'CALL_NOT_AVAILABLE'; end if; insert into public.call_participants(call_id,user_id,joined_at) values(v_id,u,now()) on conflict(call_id,user_id) do update set joined_at=excluded.joined_at,left_at=null; update public.call_sessions set status=case when status='ringing' then 'active' else status end,started_at=coalesce(started_at,now()) where id=v_id; return jsonb_build_object('call_id',v_id,'joined',true);
 when 'testagram.calls.end' then v_id:=(p_input->>'call_id')::uuid; update public.call_sessions set status='ended',ended_at=coalesce(ended_at,now()) where id=v_id and (created_by=u or exists(select 1 from public.call_participants cp where cp.call_id=v_id and cp.user_id=u)); update public.call_participants set left_at=coalesce(left_at,now()) where call_id=v_id and user_id=u; return jsonb_build_object('call_id',v_id,'ended',true);
 when 'testagram.calls.token' then return jsonb_build_object('endpoint','/functions/v1/livekit-token','provider','livekit','authenticated',true);
 when 'testagram.presence.read' then return jsonb_build_object('user_id',coalesce(nullif(p_input->>'user_id','')::uuid,u),'status','unknown','provider','testagram');
 when 'testagram.presence.set' then return jsonb_build_object('user_id',u,'status',coalesce(p_input->>'status','online'),'provider','testagram');
 when 'testagram.notifications.list' then$cap$);
  execute def;
 end if;
end $dispatch$;
