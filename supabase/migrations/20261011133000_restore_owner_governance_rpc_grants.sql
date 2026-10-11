-- Restore authenticated access to the caller-scoped owner predicates used by
-- the governance UI, owner-only TV Studio route, and Audio Spaces capability RPC.
-- Both functions derive identity from auth.uid(); neither accepts a caller-supplied user id.
grant execute on function public.testagram_is_owner() to authenticated;
grant execute on function public.testagram_get_governance() to authenticated;

-- Audio capability is SECURITY INVOKER and calls testagram_is_owner(), so it also
-- depends on the predicate's EXECUTE grant above.
grant execute on function public.get_audio_space_host_capability() to authenticated;
