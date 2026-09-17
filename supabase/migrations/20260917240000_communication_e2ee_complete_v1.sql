-- Communications E2EE completion contract.
-- The server stores and routes ciphertext for E2EE messages; plaintext is never accepted on that path.

alter table public.messages
  add column if not exists e2ee_enabled boolean not null default false,
  add column if not exists e2ee_version text,
  add column if not exists e2ee_epoch integer,
  add column if not exists ciphertext text,
  add column if not exists nonce text,
  add column if not exists aad text;

alter table public.messages
  drop constraint if exists messages_e2ee_plaintext_guard;
alter table public.messages
  add constraint messages_e2ee_plaintext_guard
  check (not e2ee_enabled or (coalesce(body,'') = '' and ciphertext is not null and nonce is not null and e2ee_epoch is not null));

create index if not exists messages_e2ee_conversation_idx
  on public.messages(conversation_id, e2ee_enabled, e2ee_epoch, created_at desc);

create table if not exists public.communication_e2ee_policy (
  id boolean primary key default true check (id),
  protocol_version text not null default 'v1',
  enabled boolean not null default true,
  server_plaintext_allowed boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.communication_e2ee_policy(id, protocol_version, enabled, server_plaintext_allowed)
values (true, 'v1', true, false)
on conflict (id) do update set protocol_version=excluded.protocol_version, enabled=excluded.enabled, server_plaintext_allowed=excluded.server_plaintext_allowed, updated_at=now();

alter table public.communication_e2ee_policy enable row level security;
drop policy if exists communication_e2ee_policy_select on public.communication_e2ee_policy;
create policy communication_e2ee_policy_select on public.communication_e2ee_policy for select to authenticated using (true);
revoke all on public.communication_e2ee_policy from anon;
grant select on public.communication_e2ee_policy to authenticated;

-- Public identity keys are not secret. Conversation members may read the public keys
-- needed to construct client-side key envelopes.
drop policy if exists communication_devices_select_conversation_members on public.communication_devices;
create policy communication_devices_select_conversation_members on public.communication_devices
for select to authenticated using (
  exists (
    select 1 from public.conversation_members cm
    where cm.user_id = (select auth.uid())
      and cm.conversation_id in (select cm2.conversation_id from public.conversation_members cm2 where cm2.user_id = communication_devices.user_id)
  )
);

create or replace function public.communication_list_devices(p_conversation_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_items jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=v_uid) then raise exception 'NOT_CONVERSATION_MEMBER'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id, x.created_at),'[]'::jsonb) into v_items
  from (
    select d.id,d.user_id,d.device_id,d.identity_public_key
    from public.communication_devices d
    join public.conversation_members cm on cm.user_id=d.user_id and cm.conversation_id=p_conversation_id
    where d.revoked_at is null
  ) x;
  return jsonb_build_object('devices',v_items);
end;
$$;

create or replace function public.communication_list_my_key_envelopes(p_conversation_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_items jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=v_uid) then raise exception 'NOT_CONVERSATION_MEMBER'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.epoch desc, x.created_at desc),'[]'::jsonb) into v_items
  from (
    select e.id,e.conversation_id,e.epoch,e.sender_device_id,e.recipient_device_id,e.ciphertext,e.nonce,e.salt,
           sd.identity_public_key as sender_public_key,e.created_at
    from public.communication_key_envelopes e
    join public.communication_devices rd on rd.id=e.recipient_device_id
    join public.communication_devices sd on sd.id=e.sender_device_id
    where e.conversation_id=p_conversation_id
      and rd.user_id=v_uid and rd.revoked_at is null
      and sd.revoked_at is null
  ) x;
  return jsonb_build_object('envelopes',v_items);
end;
$$;

create or replace function public.communication_put_key_envelope(
  p_conversation_id uuid,
  p_epoch integer,
  p_sender_device_id uuid,
  p_recipient_device_id uuid,
  p_ciphertext text,
  p_nonce text,
  p_salt text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_epoch < 1 or length(coalesce(p_ciphertext,'')) = 0 or length(coalesce(p_nonce,'')) = 0 or length(coalesce(p_salt,'')) = 0 then raise exception 'INVALID_KEY_ENVELOPE'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=v_uid) then raise exception 'NOT_CONVERSATION_MEMBER'; end if;
  if not exists (select 1 from public.communication_devices where id=p_sender_device_id and user_id=v_uid and revoked_at is null) then raise exception 'SENDER_DEVICE_NOT_OWNED'; end if;
  if not exists (select 1 from public.communication_devices rd join public.conversation_members cm on cm.user_id=rd.user_id where rd.id=p_recipient_device_id and cm.conversation_id=p_conversation_id and rd.revoked_at is null) then raise exception 'RECIPIENT_DEVICE_NOT_IN_CONVERSATION'; end if;
  insert into public.communication_key_envelopes(conversation_id,epoch,sender_device_id,recipient_device_id,ciphertext,nonce,salt)
  values(p_conversation_id,p_epoch,p_sender_device_id,p_recipient_device_id,p_ciphertext,p_nonce,p_salt)
  on conflict(conversation_id,epoch,recipient_device_id) do update
    set sender_device_id=excluded.sender_device_id,ciphertext=excluded.ciphertext,nonce=excluded.nonce,salt=excluded.salt
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.send_message_encrypted(
  p_conversation_id uuid,
  p_e2ee_version text,
  p_e2ee_epoch integer,
  p_ciphertext text,
  p_nonce text,
  p_aad text,
  p_reply_to_message_id uuid default null,
  p_shared_post_id uuid default null,
  p_client_message_id text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.communication_e2ee_policy where id=true and enabled and not server_plaintext_allowed) then raise exception 'E2EE_DISABLED'; end if;
  if not exists(select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=v_uid) then raise exception 'NOT_CONVERSATION_MEMBER'; end if;
  if p_e2ee_epoch is null or p_e2ee_epoch < 1 or length(coalesce(p_ciphertext,''))=0 or length(coalesce(p_nonce,''))=0 then raise exception 'INVALID_E2EE_MESSAGE'; end if;
  if length(p_ciphertext) > 200000 then raise exception 'MESSAGE_CIPHERTEXT_TOO_LARGE'; end if;
  if p_client_message_id is not null then
    select id into v_id from public.messages where sender_id=v_uid and client_message_id=p_client_message_id limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.messages(conversation_id,sender_id,body,reply_to_message_id,shared_post_id,client_message_id,e2ee_enabled,e2ee_version,e2ee_epoch,ciphertext,nonce,aad)
  values(p_conversation_id,v_uid,'',p_reply_to_message_id,p_shared_post_id,p_client_message_id,true,coalesce(nullif(p_e2ee_version,''),'v1'),p_e2ee_epoch,p_ciphertext,p_nonce,p_aad)
  on conflict(sender_id,client_message_id) where client_message_id is not null do nothing
  returning id into v_id;
  if v_id is null and p_client_message_id is not null then select id into v_id from public.messages where sender_id=v_uid and client_message_id=p_client_message_id limit 1; end if;
  if v_id is null then raise exception 'MESSAGE_NOT_CREATED'; end if;
  return v_id;
end;
$$;

create or replace function public.edit_message_encrypted(
  p_message_id uuid,
  p_e2ee_version text,
  p_e2ee_epoch integer,
  p_ciphertext text,
  p_nonce text,
  p_aad text
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.messages m join public.conversation_members cm on cm.conversation_id=m.conversation_id where m.id=p_message_id and m.sender_id=v_uid and cm.user_id=v_uid and m.deleted_at is null) then return false; end if;
  update public.messages set body='',e2ee_enabled=true,e2ee_version=coalesce(nullif(p_e2ee_version,''),'v1'),e2ee_epoch=p_e2ee_epoch,ciphertext=p_ciphertext,nonce=p_nonce,aad=p_aad,edited_at=now() where id=p_message_id;
  return true;
end;
$$;

create or replace function public.communication_list_messages(p_conversation_id uuid, p_limit integer default 50, p_cursor timestamptz default null)
returns jsonb
language sql
set search_path = 'public'
as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at asc) from (
      select m.id,m.conversation_id,m.sender_id,m.body,m.media_url,m.media_type,m.created_at,m.edited_at,m.deleted_at,m.reply_to_message_id,m.shared_post_id,m.client_message_id,m.delivered_at,m.read_at,
             m.e2ee_enabled,m.e2ee_version,m.e2ee_epoch,m.ciphertext,m.nonce,m.aad,
             jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'verified',(p.verified_tier is not null and p.verified_tier<>'none')) sender
      from public.messages m
      join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=auth.uid()
      left join public.profiles p on p.id=m.sender_id
      where m.conversation_id=p_conversation_id and (p_cursor is null or m.created_at<p_cursor)
      order by m.created_at desc limit greatest(1,least(coalesce(p_limit,50),100))
    ) x),'[]'::jsonb),
    'next_cursor',(select min(x.created_at)::text from (
      select m.created_at from public.messages m join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=auth.uid()
      where m.conversation_id=p_conversation_id and (p_cursor is null or m.created_at<p_cursor)
      order by m.created_at desc limit greatest(1,least(coalesce(p_limit,50),100))
    ) x)
  );
$$;

create or replace function public.create_message_notification()
returns trigger
language plpgsql
security definer
set search_path = 'public','pg_temp'
as $$
declare recipient uuid;
begin
  for recipient in select cm.user_id from public.conversation_members cm where cm.conversation_id=new.conversation_id and cm.user_id<>new.sender_id loop
    insert into public.notifications(recipient_id,actor_id,kind,created_at,data,category,group_key,action_url,dedupe_key)
    values(recipient,new.sender_id,'message.received',new.created_at,jsonb_build_object('message_id',new.id,'conversation_id',new.conversation_id,'encrypted',coalesce(new.e2ee_enabled,false)),'messages','conversation:'||new.conversation_id::text,'/messages?conversation='||new.conversation_id::text,'message:'||new.id::text)
    on conflict(dedupe_key) do nothing;
  end loop;
  return new;
end;
$$;

create or replace function public.enqueue_message_delivery()
returns trigger
language plpgsql
security definer
set search_path = 'public','pg_temp'
as $$
begin
  insert into public.communication_delivery_outbox(message_id,conversation_id,provider,event_name,payload)
  values(new.id,new.conversation_id,'matrix','message.created',jsonb_build_object(
    'message_id',new.id,
    'conversation_id',new.conversation_id,
    'sender_id',new.sender_id,
    'encrypted',coalesce(new.e2ee_enabled,false),
    'e2ee_version',new.e2ee_version,
    'e2ee_epoch',new.e2ee_epoch,
    'ciphertext',new.ciphertext,
    'nonce',new.nonce,
    'aad',new.aad,
    'created_at',new.created_at
  )) on conflict(message_id,provider) do update set payload=excluded.payload;
  return new;
end;
$$;

insert into public.capability_registry(name,version,access,readonly,enabled,description)
values
 ('testagram.communication.devices.list',1,'authenticated',true,true,'List non-revoked public communication device identities for conversation members.'),
 ('testagram.communication.keys.list',1,'authenticated',true,true,'List encrypted conversation-key envelopes addressed to the authenticated user devices.'),
 ('testagram.communication.keys.put',1,'authenticated',false,true,'Store an encrypted conversation-key envelope; plaintext keys never reach the server.'),
 ('testagram.messages.send_encrypted',1,'authenticated',false,true,'Create an E2EE message containing ciphertext only.'),
 ('testagram.messages.edit_encrypted',1,'authenticated',false,true,'Edit an E2EE message containing ciphertext only.'),
 ('testagram.communication.e2ee.status',1,'authenticated',true,true,'Read the server-authorized E2EE protocol boundary.')
on conflict(name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,enabled=excluded.enabled,description=excluded.description,updated_at=now();

do $dispatch$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='capability_dispatch'
    and pg_get_function_identity_arguments(p.oid)='p_capability text, p_input jsonb';
  if def is null then raise exception 'capability_dispatch not found'; end if;
  if position('testagram.communication.devices.list' in def)=0 then
    def:=replace(def,
      $needle$    when 'testagram.notifications.list' then$needle$,
      $insert$    when 'testagram.communication.e2ee.status' then
      select jsonb_build_object('enabled',p.enabled,'protocol_version',p.protocol_version,'server_plaintext_allowed',p.server_plaintext_allowed) into v from public.communication_e2ee_policy p where p.id=true;
      return coalesce(v,jsonb_build_object('enabled',false,'protocol_version','v1','server_plaintext_allowed',false));
    when 'testagram.communication.devices.list' then
      v_id:=(p_input->>'conversation_id')::uuid;
      select public.communication_list_devices(v_id) into v;
      return v;
    when 'testagram.communication.keys.list' then
      v_id:=(p_input->>'conversation_id')::uuid;
      select public.communication_list_my_key_envelopes(v_id) into v;
      return v;
    when 'testagram.communication.keys.put' then
      v_id:=public.communication_put_key_envelope((p_input->>'conversation_id')::uuid,(p_input->>'epoch')::int,(p_input->>'sender_device_id')::uuid,(p_input->>'recipient_device_id')::uuid,p_input->>'ciphertext',p_input->>'nonce',p_input->>'salt');
      return jsonb_build_object('envelope_id',v_id);
    when 'testagram.messages.send_encrypted' then
      v_id:=public.send_message_encrypted((p_input->>'conversation_id')::uuid,coalesce(p_input->>'e2ee_version','v1'),(p_input->>'e2ee_epoch')::int,p_input->>'ciphertext',p_input->>'nonce',p_input->>'aad',nullif(p_input->>'reply_to_message_id','')::uuid,nullif(p_input->>'shared_post_id','')::uuid,nullif(p_input->>'client_message_id',''));
      return jsonb_build_object('message_id',v_id,'encrypted',true);
    when 'testagram.messages.edit_encrypted' then
      if not public.edit_message_encrypted((p_input->>'message_id')::uuid,coalesce(p_input->>'e2ee_version','v1'),(p_input->>'e2ee_epoch')::int,p_input->>'ciphertext',p_input->>'nonce',p_input->>'aad') then raise exception 'MESSAGE_NOT_EDITABLE'; end if;
      return jsonb_build_object('message_id',(p_input->>'message_id')::uuid,'edited',true,'encrypted',true);
    when 'testagram.notifications.list' then$insert$);
    execute def;
  end if;
end $dispatch$;

-- Calls advertise their E2EE epoch only when the client has a conversation key.
do $calls$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='capability_dispatch' and pg_get_function_identity_arguments(p.oid)='p_capability text, p_input jsonb';
  if position('e2ee_enabled' in def)=0 then
    def:=replace(def,
      $needle$insert into public.call_sessions(conversation_id,created_by,room_name,kind) values(v_id,u,coalesce(nullif(p_input->>'room_name',''),'testagram-'||replace(gen_random_uuid()::text,'-','')),coalesce(nullif(p_input->>'kind',''),'video')) returning id into v2_id;$needle$,
      $replacement$insert into public.call_sessions(conversation_id,created_by,room_name,kind,e2ee_enabled,e2ee_epoch) values(v_id,u,coalesce(nullif(p_input->>'room_name',''),'testagram-'||replace(gen_random_uuid()::text,'-','')),coalesce(nullif(p_input->>'kind',''),'video'),coalesce((p_input->>'e2ee_enabled')::boolean,false),nullif(p_input->>'e2ee_epoch','')::int) returning id into v2_id;$replacement$);
    execute def;
  end if;
end $calls$;
