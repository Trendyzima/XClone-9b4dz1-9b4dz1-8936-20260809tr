-- The identity review RPC is callable only by trusted server-side code.
-- The owner-only review UI will use the trusted review path rather than exposing this
-- SECURITY DEFINER function to normal authenticated users.
revoke execute on function public.review_identity_verification(uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_identity_verification(uuid,text,text) to service_role;
