-- Canonical communication reconciliation: align frontend capabilities with the live
-- messages/calls schema and keep E2EE key material on the canonical communication tables.
create table if not exists public.communication_devices(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  identity_public_key text not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,device_id)
);
create table if not exists public.communication_key_envelopes(
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  epoch bigint not null check(epoch>0),
  sender_device_id uuid not null references public.communication_devices(id) on delete cascade,
  recipient_device_id uuid not null references public.communication_devices(id) on delete cascade,
  ciphertext text not null,
  nonce text not null,
  salt text not null,
  created_at timestamptz not null default now(),
  unique(conversation_id,epoch,recipient_device_id)
);
alter table public.communication_devices enable row level security;
alter table public.communication_key_envelopes enable row level security;
drop policy if exists communication_devices_self on public.communication_devices;
create policy communication_devices_self on public.communication_devices for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists communication_devices_self_write on public.communication_devices;
create policy communication_devices_self_write on public.communication_devices for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists communication_keys_member on public.communication_key_envelopes;
create policy communication_keys_member on public.communication_key_envelopes for select to authenticated using(
  exists(select 1 from public.conversation_members cm where cm.conversation_id=communication_key_envelopes.conversation_id and cm.user_id=(select auth.uid()) and cm.left_at is null)
  and exists(select 1 from public.communication_devices d where d.id=communication_key_envelopes.recipient_device_id and d.user_id=(select auth.uid()))
);
revoke all on public.communication_key_envelopes from anon,authenticated;
grant select,insert on public.communication_key_envelopes to authenticated;
drop policy if exists communication_keys_member_write on public.communication_key_envelopes;
create policy communication_keys_member_write on public.communication_key_envelopes for insert to authenticated with check(exists(select 1 from public.conversation_members cm where cm.conversation_id=communication_key_envelopes.conversation_id and cm.user_id=(select auth.uid()) and cm.left_at is null) and exists(select 1 from public.communication_devices d where d.id=communication_key_envelopes.sender_device_id and d.user_id=(select auth.uid())));
grant select,insert,update,delete on public.communication_devices to authenticated;
create index if not exists communication_key_envelopes_lookup_idx on public.communication_key_envelopes(conversation_id,epoch,recipient_device_id);

-- Enable the Realtime publication for the canonical communication tables used by the browser.
do $ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='calls') then
    execute 'alter publication supabase_realtime add table public.calls';
  end if;
end $;

insert into public.capability_registry(name,version,access,readonly,enabled,description) values
('testagram.conversations.list',1,'authenticated',true,true,'List conversations for current user'),
('testagram.conversations.create',1,'authenticated',false,true,'Create a conversation and memberships'),
('testagram.messages.list',1,'authenticated',true,true,'List encrypted conversation messages'),
('testagram.messages.send_encrypted',1,'authenticated',false,true,'Send an end-to-end encrypted message'),
('testagram.messages.edit_encrypted',1,'authenticated',false,true,'Edit an end-to-end encrypted message'),
('testagram.messages.delete',1,'authenticated',false,true,'Delete a message'),
('testagram.messages.attach',1,'authenticated',false,true,'Attach message metadata'),
('testagram.messages.mark_read',1,'authenticated',false,true,'Advance conversation read watermark'),
('testagram.messages.react',1,'authenticated',false,true,'Add or remove a message reaction'),
('testagram.calls.create',1,'authenticated',false,true,'Create a call'),
('testagram.calls.join',1,'authenticated',false,true,'Join a call'),
('testagram.calls.end',1,'authenticated',false,true,'End a call'),
('testagram.communication.devices.list',1,'authenticated',true,true,'List devices in a conversation'),
('testagram.communication.keys.list',1,'authenticated',true,true,'List key envelopes for current device'),
('testagram.communication.keys.put',1,'authenticated',false,true,'Store a key envelope for a conversation device')
on conflict(name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,enabled=true,description=excluded.description,updated_at=now();

-- Patch the existing gateway dispatcher without duplicating the rest of its capability
-- surface. The dispatcher is the authoritative browser boundary.
do $patch$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='capability_dispatch'
    and pg_get_function_identity_arguments(p.oid)='p_capability text, p_input jsonb';
  if def is null then raise exception 'capability_dispatch not found'; end if;
  if position('testagram.messages.send_encrypted' in def)=0 then
    def:=replace(def,
      'else raise exception using errcode=''0A000'',message=''Capability not implemented: ''||p_capability;',
      $cap$
when 'testagram.conversations.list' then
  return jsonb_build_object('items',coalesce((
    select jsonb_agg(x.obj order by x.updated_at desc) from (
      select c.updated_at,jsonb_build_object(
        'id',c.id,'created_at',c.created_at,'updated_at',c.updated_at,'kind',c.kind,'title',c.title,
        'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'verified',(p.verified_tier is not null and p.verified_tier<>'none')) order by p.username)
          from public.conversation_members cm join public.profiles p on p.id=cm.user_id
          where cm.conversation_id=c.id and cm.left_at is null),'[]'::jsonb)
      ) obj
      from public.conversations c
      where exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=v_user_id and cm.left_at is null)
      order by c.updated_at desc limit v_limit
    ) x),'[]'::jsonb));

when 'testagram.conversations.create' then
begin
  declare new_conversation uuid;
  begin
    insert into public.conversations(created_by,kind,encrypted)
    values(v_user_id,case when jsonb_array_length(coalesce(p_input->'member_ids','[]'::jsonb))>1 then 'group' else 'direct' end,true)
    returning id into new_conversation;
    insert into public.conversation_members(conversation_id,user_id,role) values(new_conversation,v_user_id,'owner');
    insert into public.conversation_members(conversation_id,user_id,role)
      select new_conversation,x::uuid,'member' from jsonb_array_elements_text(coalesce(p_input->'member_ids','[]'::jsonb)) x
      where x::uuid<>v_user_id on conflict do nothing;
    return jsonb_build_object('conversation_id',new_conversation);
  end;
end;

when 'testagram.messages.list' then
begin
  return jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'conversation_id',m.conversation_id,'sender_id',m.sender_id,
      'ciphertext',m.ciphertext,'nonce',m.nonce,'e2ee_epoch',m.key_epoch,'e2ee_enabled',true,
      'created_at',m.created_at,'edited_at',m.edited_at,'deleted_at',m.deleted_at,
      'reply_to_message_id',m.reply_to_id,'client_message_id',m.client_message_id,
      'message_type',m.message_type,'attachment_metadata',m.attachment_metadata,
      'sender',jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'verified',(p.verified_tier is not null and p.verified_tier<>'none'))
    ) order by m.created_at asc),'[]'::jsonb)
    from (select * from public.messages m
      where m.conversation_id=(p_input->>'conversation_id')::uuid
        and exists(select 1 from public.conversation_members cm where cm.conversation_id=m.conversation_id and cm.user_id=v_user_id and cm.left_at is null)
        and (nullif(p_input->>'cursor','') is null or m.created_at<(p_input->>'cursor')::timestamptz)
      order by m.created_at desc limit v_limit) m
    left join public.profiles p on p.id=m.sender_id),'next_cursor',null);
end;

when 'testagram.messages.send_encrypted' then
begin
  declare new_message uuid;
  begin
    insert into public.messages(conversation_id,sender_id,client_message_id,ciphertext,nonce,key_epoch,message_type,reply_to_id,attachment_metadata)
    values((p_input->>'conversation_id')::uuid,v_user_id,nullif(p_input->>'client_message_id',''),p_input->>'ciphertext',p_input->>'nonce',coalesce((p_input->>'e2ee_epoch')::bigint,0),'text',nullif(p_input->>'reply_to_message_id','')::uuid,'[]'::jsonb)
    on conflict(conversation_id,client_message_id) do update set client_message_id=excluded.client_message_id
    returning id into new_message;
    return jsonb_build_object('message_id',new_message,'encrypted',true);
  end;
end;

when 'testagram.messages.edit_encrypted' then
begin
  update public.messages set ciphertext=p_input->>'ciphertext',nonce=p_input->>'nonce',key_epoch=coalesce((p_input->>'e2ee_epoch')::bigint,key_epoch),edited_at=now(),updated_at=now()
  where id=(p_input->>'message_id')::uuid and sender_id=v_user_id;
  if not found then raise exception 'MESSAGE_NOT_FOUND'; end if;
  return jsonb_build_object('message_id',(p_input->>'message_id')::uuid,'edited',true);
end;

when 'testagram.messages.delete' then
begin
  update public.messages set deleted_at=now(),updated_at=now() where id=(p_input->>'message_id')::uuid and sender_id=v_user_id;
  if not found then raise exception 'MESSAGE_NOT_FOUND'; end if;
  return jsonb_build_object('message_id',(p_input->>'message_id')::uuid,'deleted',true);
end;

when 'testagram.messages.attach' then
begin
  update public.messages set attachment_metadata=coalesce(attachment_metadata,'[]'::jsonb)||jsonb_build_array(jsonb_build_object(
    'media_url',p_input->>'media_url','media_type',p_input->>'media_type','mime_type',p_input->>'mime_type',
    'byte_size',(p_input->>'byte_size')::bigint)),updated_at=now()
  where id=(p_input->>'message_id')::uuid and sender_id=v_user_id;
  if not found then raise exception 'MESSAGE_NOT_FOUND'; end if;
  return jsonb_build_object('attachment',jsonb_build_object('message_id',(p_input->>'message_id')::uuid,'media_url',p_input->>'media_url','media_type',p_input->>'media_type','byte_size',(p_input->>'byte_size')::bigint));
end;

when 'testagram.messages.mark_read' then
begin
  update public.conversation_members cm set last_read_at=greatest(coalesce(cm.last_read_at,'epoch'::timestamptz),m.created_at)
  from public.messages m where m.id=(p_input->>'message_id')::uuid and cm.conversation_id=m.conversation_id and cm.user_id=v_user_id;
  return jsonb_build_object('message_id',(p_input->>'message_id')::uuid,'read',true);
end;

when 'testagram.messages.react' then
begin
  if coalesce((p_input->>'remove')::boolean,false) then
    delete from public.message_reactions where message_id=(p_input->>'message_id')::uuid and user_id=v_user_id and emoji=p_input->>'reaction';
  else
    insert into public.message_reactions(message_id,user_id,emoji) values((p_input->>'message_id')::uuid,v_user_id,p_input->>'reaction') on conflict do nothing;
  end if;
  return jsonb_build_object('message_id',(p_input->>'message_id')::uuid,'reaction',p_input->>'reaction','removed',coalesce((p_input->>'remove')::boolean,false));
end;

when 'testagram.calls.create' then
begin
  declare new_call uuid;
  begin
    insert into public.calls(conversation_id,created_by,provider,room_name,kind,status,metadata)
    values((p_input->>'conversation_id')::uuid,v_user_id,'livekit',coalesce(nullif(p_input->>'room_name',''),'testagram-'||replace(gen_random_uuid()::text,'-','')),coalesce(nullif(p_input->>'kind',''),'video'),'ringing',jsonb_build_object('e2ee_enabled',true,'e2ee_epoch',coalesce((p_input->>'e2ee_epoch')::bigint,0)))
    returning id into new_call;
    insert into public.call_participants(call_id,user_id,joined_at) values(new_call,v_user_id,now()) on conflict do nothing;
    return jsonb_build_object('call_id',new_call,'provider','livekit','room_name',(select room_name from public.calls where id=new_call),'kind',(select kind from public.calls where id=new_call),'created_by',v_user_id,'status','ringing','conversation_id',(p_input->>'conversation_id')::uuid);
  end;
end;

when 'testagram.calls.join' then
begin
  update public.calls c set status=case when status='ringing' then 'active' else status end,started_at=coalesce(started_at,now())
  where c.id=(p_input->>'call_id')::uuid and exists(select 1 from public.conversation_members cm where cm.conversation_id=c.conversation_id and cm.user_id=v_user_id and cm.left_at is null);
  if not found then raise exception 'CALL_NOT_AVAILABLE'; end if;
  insert into public.call_participants(call_id,user_id,joined_at) values((p_input->>'call_id')::uuid,v_user_id,now()) on conflict(call_id,user_id) do update set joined_at=excluded.joined_at,left_at=null;
  return jsonb_build_object('call_id',(p_input->>'call_id')::uuid,'joined',true);
end;

when 'testagram.calls.end' then
begin
  update public.calls c set status='ended',ended_at=coalesce(ended_at,now())
  where c.id=(p_input->>'call_id')::uuid and (c.created_by=v_user_id or exists(select 1 from public.call_participants cp where cp.call_id=c.id and cp.user_id=v_user_id));
  update public.call_participants set left_at=coalesce(left_at,now()) where call_id=(p_input->>'call_id')::uuid and user_id=v_user_id;
  return jsonb_build_object('call_id',(p_input->>'call_id')::uuid,'ended',true);
end;

when 'testagram.communication.devices.list' then
  return jsonb_build_object('devices',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'user_id',d.user_id,'device_id',d.device_id,'identity_public_key',d.identity_public_key) order by d.created_at) from public.communication_devices d where d.revoked_at is null and exists(select 1 from public.conversation_members cm where cm.conversation_id=(p_input->>'conversation_id')::uuid and cm.user_id=d.user_id and cm.left_at is null)),'[]'::jsonb));

when 'testagram.communication.keys.list' then
  return jsonb_build_object('envelopes',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'conversation_id',e.conversation_id,'epoch',e.epoch,'sender_device_id',e.sender_device_id,'recipient_device_id',e.recipient_device_id,'ciphertext',e.ciphertext,'nonce',e.nonce,'salt',e.salt,'sender_public_key',sd.identity_public_key) order by e.epoch desc,e.created_at desc) from public.communication_key_envelopes e join public.communication_devices rd on rd.id=e.recipient_device_id and rd.user_id=v_user_id join public.communication_devices sd on sd.id=e.sender_device_id where e.conversation_id=(p_input->>'conversation_id')::uuid),'[]'::jsonb));

when 'testagram.communication.keys.put' then
begin
  insert into public.communication_key_envelopes(conversation_id,epoch,sender_device_id,recipient_device_id,ciphertext,nonce,salt)
  select (p_input->>'conversation_id')::uuid,(p_input->>'epoch')::bigint,(p_input->>'sender_device_id')::uuid,(p_input->>'recipient_device_id')::uuid,p_input->>'ciphertext',p_input->>'nonce',p_input->>'salt'
  where exists(select 1 from public.conversation_members cm where cm.conversation_id=(p_input->>'conversation_id')::uuid and cm.user_id=v_user_id and cm.left_at is null)
  on conflict(conversation_id,epoch,recipient_device_id) do update set ciphertext=excluded.ciphertext,nonce=excluded.nonce,salt=excluded.salt,sender_device_id=excluded.sender_device_id;
  return jsonb_build_object('envelope_id',(select id from public.communication_key_envelopes where conversation_id=(p_input->>'conversation_id')::uuid and epoch=(p_input->>'epoch')::bigint and recipient_device_id=(p_input->>'recipient_device_id')::uuid));
end;

else raise exception using errcode='0A000',message='Capability not implemented: '||p_capability;
$cap$);
    execute def;
  end if;
end $patch$;
