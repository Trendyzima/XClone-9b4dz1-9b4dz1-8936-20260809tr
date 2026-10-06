-- Testagram magic-link delivery now uses the owned Edge Function + Resend
-- and no longer keeps an application-level magic-link rate-limit store.
drop table if exists private.auth_magic_link_rate_limits;
