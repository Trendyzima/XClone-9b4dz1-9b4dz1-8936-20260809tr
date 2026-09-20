create or replace function public.send_wallet_tip(
  p_to_user_id uuid,
  p_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_from uuid := auth.uid();
  v_amount numeric := round(p_amount, 2);
  v_transfer jsonb;
  v_tip_id uuid;
begin
  if v_from is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_to_user_id is null or p_to_user_id = v_from then raise exception 'INVALID_RECIPIENT'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if v_amount > 10000 then raise exception 'TIP_LIMIT_EXCEEDED'; end if;
  v_transfer := public.p2p_wallet_transfer(v_from, p_to_user_id, v_amount, p_note);
  insert into public.tips(from_user_id,to_user_id,amount)
  values(v_from,p_to_user_id,round(v_amount)::bigint)
  returning id into v_tip_id;
  return v_transfer || jsonb_build_object('tip_id',v_tip_id);
end;
$$;
revoke execute on function public.send_wallet_tip(uuid,numeric,text) from public,anon;
grant execute on function public.send_wallet_tip(uuid,numeric,text) to authenticated;

create or replace function public.send_space_superchat(
  p_space_id uuid,
  p_amount numeric,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_from uuid := auth.uid();
  v_host uuid;
  v_amount numeric := round(p_amount, 2);
  v_message text := nullif(left(btrim(coalesce(p_message,'')), 280), '');
  v_transfer jsonb;
  v_superchat_id uuid;
begin
  if v_from is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_space_id is null then raise exception 'SPACE_REQUIRED'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if v_amount > 10000 then raise exception 'SUPERCHAT_LIMIT_EXCEEDED'; end if;
  if v_message is null then raise exception 'MESSAGE_REQUIRED'; end if;
  select host_id into v_host from public.spaces where id=p_space_id and is_live=true and ended_at is null for share;
  if v_host is null then raise exception 'SPACE_NOT_LIVE'; end if;
  if v_host=v_from then raise exception 'INVALID_RECIPIENT'; end if;
  v_transfer := public.p2p_wallet_transfer(v_from,v_host,v_amount,'Super Chat in Space '||p_space_id::text);
  insert into public.space_superchats(space_id,user_id,message,amount,color,pinned_until)
  values(p_space_id,v_from,v_message,round(v_amount)::bigint,'gold',now()+interval '60 seconds')
  returning id into v_superchat_id;
  return v_transfer || jsonb_build_object('superchat_id',v_superchat_id);
end;
$$;
revoke execute on function public.send_space_superchat(uuid,numeric,text) from public,anon;
grant execute on function public.send_space_superchat(uuid,numeric,text) to authenticated;