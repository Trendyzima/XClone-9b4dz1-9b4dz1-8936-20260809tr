-- Testagram Notifications 2.0: native notification source of truth + Novu delivery bridge.
-- Novu is deliberately kept out of the browser and out of the canonical notification tables.

insert into public.capability_registry(name, version, access, readonly, description, enabled)
values
  ('testagram.notifications.list', 1, 'authenticated', true, 'List the authenticated user\'s canonical notifications.', true),
  ('testagram.notifications.unread_count', 1, 'authenticated', true, 'Read the authenticated user\'s unread notification count.', true),
  ('testagram.notifications.mark_read', 1, 'authenticated', false, 'Mark one canonical notification as read.', true),
  ('testagram.notifications.mark_all_read', 1, 'authenticated', false, 'Mark all canonical notifications as read.', true),
  ('testagram.notifications.preferences', 1, 'authenticated', true, 'Read canonical notification preferences.', true),
  ('testagram.notifications.preference_upsert', 1, 'authenticated', false, 'Update one canonical notification preference.', true),
  ('testagram.notifications.dismiss', 1, 'authenticated', false, 'Archive one canonical notification.', true),
  ('testagram.notifications.subscribe', 1, 'authenticated', true, 'Return the canonical realtime notification subscription contract.', true)
on conflict (name) do update set
  version=excluded.version,
  access=excluded.access,
  readonly=excluded.readonly,
  description=excluded.description,
  enabled=true;

-- Inject the notification cases into the already-authoritative dispatcher without
-- duplicating or rewriting its existing capability implementations.
do $$
declare
  def text;
  injected text := $inject$
  when 'testagram.notifications.list' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v
    from (
      select n.id,n.recipient_id,n.actor_id,n.kind,n.post_id,n.read_at,n.created_at,
             n.data,n.priority,n.category,n.group_key,n.action_url,n.expires_at,n.archived_at,n.dedupe_key,
             jsonb_build_object(
               'id',pr.id,
               'username',pr.username,
               'display_name',pr.display_name,
               'avatar_url',pr.avatar_url,
               'verified',case when pr.verified_tier is not null and pr.verified_tier <> 'none' then true else false end
             ) as actor
      from public.notifications n
      left join public.profiles pr on pr.id=n.actor_id
      where n.recipient_id=u
        and n.archived_at is null
        and (n.expires_at is null or n.expires_at > now())
        and (coalesce(p_input->>'kind','')='' or n.kind=p_input->>'kind')
        and (coalesce(p_input->>'category','')='' or n.category=p_input->>'category')
        and (coalesce((p_input->>'unread_only')::boolean,false)=false or n.read_at is null)
      order by n.created_at desc
      limit v_limit offset v_offset
    ) x;
    return jsonb_build_object('items',v,'next_cursor',case when jsonb_array_length(v)=v_limit then (v_offset+v_limit)::text else null end);
  when 'testagram.notifications.unread_count' then
    select count(*) into v_id
    from public.notifications n
    where n.recipient_id=u and n.read_at is null and n.archived_at is null
      and (n.expires_at is null or n.expires_at > now());
    return jsonb_build_object('count',v_id::text::int);
  when 'testagram.notifications.mark_read' then
    v_id:=(p_input->>'notification_id')::uuid;
    update public.notifications set read_at=coalesce(read_at,now()) where id=v_id and recipient_id=u;
    return jsonb_build_object('notification_id',v_id,'read',true);
  when 'testagram.notifications.mark_all_read' then
    update public.notifications set read_at=now() where recipient_id=u and read_at is null and archived_at is null;
    get diagnostics v_limit = row_count;
    return jsonb_build_object('updated',v_limit);
  when 'testagram.notifications.preferences' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v
    from (select id,user_id,notif_type,in_app,push,email,sound_enabled,vibration_enabled,digest_frequency,quiet_hours_start,quiet_hours_end,timezone,muted_until,updated_at
          from public.notification_preferences where user_id=u order by notif_type) x;
    return jsonb_build_object('items',v);
  when 'testagram.notifications.preference_upsert' then
    v_text:=trim(p_input->>'notif_type');
    if v_text is null or v_text='' then raise exception 'NOTIFICATION_TYPE_REQUIRED'; end if;
    insert into public.notification_preferences(user_id,notif_type,in_app,push,email,sound_enabled,vibration_enabled,digest_frequency,quiet_hours_start,quiet_hours_end,timezone,muted_until,updated_at)
    values(u,v_text,coalesce((p_input->>'in_app')::boolean,true),coalesce((p_input->>'push')::boolean,false),coalesce((p_input->>'email')::boolean,false),coalesce((p_input->>'sound_enabled')::boolean,true),coalesce((p_input->>'vibration_enabled')::boolean,true),coalesce(nullif(p_input->>'digest_frequency',''),'instant'),nullif(p_input->>'quiet_hours_start','')::time,nullif(p_input->>'quiet_hours_end','')::time,coalesce(nullif(p_input->>'timezone',''),'UTC'),nullif(p_input->>'muted_until','')::timestamptz,now())
    on conflict(user_id,notif_type) do update set in_app=excluded.in_app,push=excluded.push,email=excluded.email,sound_enabled=excluded.sound_enabled,vibration_enabled=excluded.vibration_enabled,digest_frequency=excluded.digest_frequency,quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,timezone=excluded.timezone,muted_until=excluded.muted_until,updated_at=now()
    returning to_jsonb(notification_preferences.*) into v;
    return jsonb_build_object('preference',v);
  when 'testagram.notifications.dismiss' then
    v_id:=(p_input->>'notification_id')::uuid;
    update public.notifications set archived_at=coalesce(archived_at,now()) where id=v_id and recipient_id=u;
    return jsonb_build_object('notification_id',v_id,'dismissed',true);
  when 'testagram.notifications.subscribe' then
    return jsonb_build_object('schema','public','table','notifications','event','INSERT','filter','recipient_id=eq.'||u::text,'authenticated',true);
$inject$;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='capability_dispatch'
    and pg_get_function_identity_arguments(p.oid)='p_capability text, p_input jsonb DEFAULT \'{}\'::jsonb';
  if def is null then raise exception 'CAPABILITY_DISPATCH_NOT_FOUND'; end if;
  if position('testagram.notifications.list' in def) > 0 then return; end if;
  def := replace(def, ' else raise exception ''CAPABILITY_NOT_IMPLEMENTED'';', injected || ' else raise exception ''CAPABILITY_NOT_IMPLEMENTED'';');
  execute def;
end $$;

-- Make sure the authenticated role can execute the dispatcher after replacement.
grant execute on function public.capability_dispatch(text,jsonb) to authenticated;

-- Keep the native notification table authoritative while giving delivery infrastructure
-- a stable outbox boundary. The outbox is intentionally service-side only.
create table if not exists public.notification_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  recipient_id uuid not null,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create unique index if not exists notification_delivery_outbox_notification_uidx
  on public.notification_delivery_outbox(notification_id);
create index if not exists notification_delivery_outbox_pending_idx
  on public.notification_delivery_outbox(status,next_attempt_at,created_at);

alter table public.notification_delivery_outbox enable row level security;

create or replace function public.enqueue_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.notification_delivery_outbox(notification_id,recipient_id,event_name,payload)
  values(
    new.id,
    new.recipient_id,
    new.kind,
    jsonb_build_object(
      'notification_id',new.id,
      'recipient_id',new.recipient_id,
      'actor_id',new.actor_id,
      'kind',new.kind,
      'post_id',new.post_id,
      'category',new.category,
      'priority',new.priority,
      'group_key',new.group_key,
      'action_url',new.action_url
    )
  )
  on conflict(notification_id) do nothing;
  return new;
end;
$$;

drop trigger if exists notifications_enqueue_delivery on public.notifications;
create trigger notifications_enqueue_delivery
after insert on public.notifications
for each row execute function public.enqueue_notification_delivery();

-- No client role is granted access to the delivery outbox.
revoke all on table public.notification_delivery_outbox from anon,authenticated;
revoke all on function public.enqueue_notification_delivery() from anon,authenticated;

after commit;
