-- Restore the canonical atomic post writer after later dispatcher migrations
-- replaced capability_dispatch with a legacy router. The production symptom was
-- deterministic: testagram.posts.create reached capability_dispatch_legacy, which
-- directly INSERTed into posts under RLS instead of calling create_post_atomic.
--
-- This migration patches the currently deployed dispatcher without depending on
-- the historical function body. It only replaces its final legacy delegation with
-- an explicit posts.create branch, preserving every other capability branch.

do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid)
    into src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'capability_dispatch'
    and p.proargtypes::regtype[] = ARRAY['text'::regtype,'jsonb'::regtype]
  limit 1;

  if src is null then
    raise exception 'CAPABILITY_DISPATCH_NOT_FOUND';
  end if;

  if position('when ''testagram.posts.create'' then' in src) > 0 then
    return;
  end if;

  if position('else return public.capability_dispatch_legacy(p_capability,p_input);' in src) = 0 then
    raise exception 'CAPABILITY_DISPATCH_LEGACY_FALLTHROUGH_NOT_FOUND';
  end if;

  patched := replace(
    src,
    'else return public.capability_dispatch_legacy(p_capability,p_input);',
    'when ''testagram.posts.create'' then return public.create_post_atomic(p_input);
   else return public.capability_dispatch_legacy(p_capability,p_input);'
  );

  execute patched;
end
$$;

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

revoke all on function public.create_post_atomic(jsonb) from public;
grant execute on function public.create_post_atomic(jsonb) to authenticated;
