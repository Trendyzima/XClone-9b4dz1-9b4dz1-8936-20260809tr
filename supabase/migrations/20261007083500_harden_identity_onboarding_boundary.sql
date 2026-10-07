-- Harden identity onboarding by retiring the obsolete browser/service boundary.
-- The active identity-signup flow owns registration creation and Didit session orchestration.
-- create_identity_verification references the legacy manual-review contract and is service-only.
revoke all on function public.create_identity_verification(uuid, text, text, text, text, inet, text) from public, anon, authenticated;
grant execute on function public.create_identity_verification(uuid, text, text, text, text, inet, text) to service_role;
