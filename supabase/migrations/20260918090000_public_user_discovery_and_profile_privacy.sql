-- Public user discovery + profile privacy controls.
-- Username discovery is independently controllable; protected accounts remain discoverable
-- but their protected posts stay subject to post RLS/follow semantics.

alter table public.profiles
  add column if not exists discoverable_by_username boolean not null default true;

update public.capability_registry
set access = 'public', updated_at = now()
where name in (
  'testagram.search.users',
  'testagram.search.posts',
  'testagram.search.hashtags',
  'testagram.search.communities',
  'testagram.trends.list'
);

grant execute on function public.capability_dispatch(text,jsonb) to anon;

-- Preserve the existing capability dispatcher and only relax authentication for
-- explicitly public discovery capabilities.
do $outer$
declare
  def text;
begin
  select pg_get_functiondef(p.oid)
    into def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'capability_dispatch'
    and pg_get_function_identity_arguments(p.oid) = 'p_capability text, p_input jsonb';

  if def is null then
    raise exception 'capability_dispatch not found';
  end if;

  def := replace(
    def,
    'if u is null then raise exception ''AUTH_REQUIRED''; end if;',
    $$if u is null and p_capability not in (
      'testagram.search.users',
      'testagram.search.posts',
      'testagram.search.hashtags',
      'testagram.search.communities',
      'testagram.trends.list'
    ) then
      raise exception 'AUTH_REQUIRED';
    end if;$inner$
  );

  -- Replace the user-search predicate/output without exposing private profile
  -- settings. The public result is an explicit safe profile projection.
  def := replace(
    def,
    $inner$select id,username,display_name,avatar_url,bio,(verified_tier is not null and verified_tier <> 'none') as verified,follower_count as followers_count
        from public.profiles
        where username ilike '%'||v_text||'%' or display_name ilike '%'||v_text||'%' or bio ilike '%'||v_text||'%'
        order by follower_count desc nulls last,username$$,
    $$select id,username,display_name,avatar_url,bio,
          (verified_tier is not null and verified_tier <> 'none') as verified,
          follower_count as followers_count,
          protected_account
        from public.profiles
        where discoverable_by_username = true
          and (username ilike '%'||v_text||'%' or display_name ilike '%'||v_text||'%' or bio ilike '%'||v_text||'%')
        order by follower_count desc nulls last,username$inner$
  );

  execute def;
end $outer$;
