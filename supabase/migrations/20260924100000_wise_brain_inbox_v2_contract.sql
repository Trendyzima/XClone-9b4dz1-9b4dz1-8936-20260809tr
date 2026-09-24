-- Wise Brain Inbox v2: repair the capability recursion and make the daily digest
-- reflect today's real activity, wallet movements, and unread notifications.

create or replace function public.generate_platform_inbox_digest()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_posts bigint := 0;
  v_likes bigint := 0;
  v_reposts bigint := 0;
  v_replies bigint := 0;
  v_engagement bigint := 0;
  v_incoming numeric := 0;
  v_outgoing numeric := 0;
  v_currency text := 'KES';
  v_unread bigint := 0;
  v_id uuid;
  v_dedupe text;
begin
  if v_user_id is null then
    raise exception using errcode='28000', message='Authentication required';
  end if;

  select count(*) into v_posts
  from public.posts
  where coalesce(author_id,user_id)=v_user_id and deleted_at is null
    and created_at >= v_today::timestamptz and created_at < (v_today + 1)::timestamptz;

  select count(*) into v_likes from public.post_reactions
  where user_id=v_user_id and created_at >= v_today::timestamptz and created_at < (v_today + 1)::timestamptz;

  select count(*) into v_reposts from public.reposts
  where user_id=v_user_id and created_at >= v_today::timestamptz and created_at < (v_today + 1)::timestamptz;

  select count(*) into v_replies from public.replies
  where user_id=v_user_id and created_at >= v_today::timestamptz and created_at < (v_today + 1)::timestamptz;

  v_engagement := v_likes + v_reposts + v_replies;

  select
    coalesce(sum(case when lower(coalesce(direction,'')) in ('in','incoming','credit') then coalesce(amount, amount_cents/100.0, 0) else 0 end),0),
    coalesce(sum(case when lower(coalesce(direction,'')) in ('out','outgoing','debit') then coalesce(amount, amount_cents/100.0, 0) else 0 end),0),
    coalesce(max(currency) filter (where currency is not null and currency<>''),'KES')
  into v_incoming, v_outgoing, v_currency
  from public.wallet_transactions
  where user_id=v_user_id::text
    and created_at >= v_today::timestamptz and created_at < (v_today + 1)::timestamptz
    and lower(coalesce(status,'')) not in ('failed','cancelled','canceled','reversed');

  select count(*) into v_unread from public.notifications
  where coalesce(recipient_id,user_id)=v_user_id and coalesce(read,false)=false;

  v_dedupe := 'wise_brain:daily:' || v_user_id::text || ':' || v_today::text;

  insert into public.platform_inbox
    (user_id,type,subject,body,icon_emoji,cta_label,cta_url,read,sent_at,dedupe_key,metadata,generation_version)
  values
    (v_user_id,'update','Wise Brain • Daily Briefing',
     format('Today: %s post%s and %s engagement action%s. Wallet: %s %s incoming and %s %s outgoing. %s unread update%s remain in your inbox.',
       v_posts,case when v_posts=1 then '' else 's' end,
       v_engagement,case when v_engagement=1 then '' else 's' end,
       to_char(v_incoming,'FM999,999,999,990.00'),v_currency,
       to_char(v_outgoing,'FM999,999,999,990.00'),v_currency,
       v_unread,case when v_unread=1 then '' else 's' end),
     '🦉','Open Inbox','/platform-inbox',false,now(),v_dedupe,
     jsonb_build_object('source','wise_brain','category','updates','utc_day',v_today::text,
       'posts',v_posts,'likes',v_likes,'reposts',v_reposts,'replies',v_replies,
       'engagement',v_engagement,'incoming',v_incoming,'outgoing',v_outgoing,
       'currency',v_currency,'unread_updates',v_unread),7)
  on conflict (dedupe_key) do update set
    body=excluded.body,icon_emoji=excluded.icon_emoji,cta_label=excluded.cta_label,
    cta_url=excluded.cta_url,sent_at=excluded.sent_at,metadata=excluded.metadata,
    generation_version=excluded.generation_version;

  select id into v_id from public.platform_inbox
  where user_id=v_user_id and dedupe_key=v_dedupe;

  return jsonb_build_object(
    'message',to_jsonb((select i from public.platform_inbox i where i.id=v_id)),
    'generated',true,'idempotent',true
  );
end;
$function$;

revoke all on function public.generate_platform_inbox_digest() from public, anon;
grant execute on function public.generate_platform_inbox_digest() to authenticated;
