-- Production-safe replacement for the post-create dispatcher.
-- A later historical migration replaced capability_dispatch with a router whose
-- fallback is capability_dispatch_legacy. Rebuild that small router explicitly
-- instead of introspecting the existing function definition: this also works
-- when Postgres normalizes the function argument identity in pg_proc.

create or replace function public.capability_dispatch(
  p_capability text,
  p_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  p_capability := btrim(coalesce(p_capability, ''));

  if p_capability not in ('testagram.capabilities.list', 'testagram.health.read')
     and v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  case p_capability
    when 'testagram.posts.create' then
      return public.create_post_atomic(p_input);
    else
      return public.capability_dispatch_legacy(p_capability, p_input);
  end case;
end;
$function$;

revoke all on function public.capability_dispatch(text,jsonb) from public;
grant execute on function public.capability_dispatch(text,jsonb) to anon, authenticated;

insert into public.capability_registry(
  name, version, access, readonly, enabled, description
)
values (
  'testagram.posts.create',
  2,
  'authenticated',
  false,
  true,
  'Create a native Testagram post, including polls, atomically.'
)
on conflict (name) do update set
  version = excluded.version,
  access = excluded.access,
  readonly = excluded.readonly,
  enabled = true,
  description = excluded.description,
  updated_at = now();
