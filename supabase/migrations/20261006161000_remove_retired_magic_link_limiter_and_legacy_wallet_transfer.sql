-- Remove retired application-level magic-link rate limiter and the obsolete insecure wallet transfer overload.
drop function if exists public.check_testagram_magic_link_rate_limit(text);
revoke execute on function public.send_wallet_money(text,numeric,text,text) from public, anon, authenticated;