create or replace function public.capability_dispatch(
  p_capability text,
  p_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_q text := btrim(coalesce(p_input->>'q', ''));
  v_limit integer := least(100, greatest(1, coalesce((p_input->>'limit')::integer, 20)));
  v_target_id uuid;
  v_status text;
begin
  p_capability := btrim(coalesce(p_capability, ''));
  if p_capability not in ('testagram.capabilities.list','testagram.health.read') and v_user_id is null then
    raise exception using errcode='28000',message='Authentication required';
  end if;
  case p_capability
    when 'testagram.capabilities.list' then
      return jsonb_build_object('capabilities',coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from public.capability_registry c where c.enabled),'[]'::jsonb));
    when 'testagram.health.read' then
      return jsonb_build_object('services',jsonb_build_array(jsonb_build_object('service','database','status','ok'),jsonb_build_object('service','capability-gateway','status','ok')));
    when 'testagram.search.hashtags' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(s) order by lower(s.tag),s.id) from (
        select h.id,h.tag,h.usage_count,h.post_count,h.follower_count,h.last_used_at,h.created_at
        from public.hashtags h
        where v_q='' or position(lower(replace(v_q,'#','')) in lower(h.tag))>0
        order by h.usage_count desc nulls last,h.last_used_at desc nulls last,lower(h.tag),h.id
        limit v_limit
      ) s),'[]'::jsonb),'next_cursor',null);
    when 'testagram.search.users' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(s) order by lower(s.username),s.id) from (
        select p.id,p.username,p.display_name,p.avatar_url,p.bio,p.verified_tier,p.verified,p.follower_count,p.following_count,p.posts_count as post_count,p.protected_account,p.created_at
        from public.profiles p where p.account_status='active' and p.discoverable_by_username=true and (v_q='' or position(lower(v_q) in lower(p.username))>0 or position(lower(v_q) in lower(coalesce(p.display_name,'')))>0)
        order by lower(p.username),p.id limit v_limit) s),'[]'::jsonb),'next_cursor',null);
    else
      raise exception using errcode='0A000',message='Capability not implemented: '||p_capability;
  end case;
end;
$$;
revoke all on function public.capability_dispatch(text,jsonb) from public;
grant execute on function public.capability_dispatch(text,jsonb) to anon,authenticated;