-- Production security boundary for internal service health telemetry.
-- The view does not need SECURITY DEFINER semantics: it only aggregates
-- service_metrics and must execute with the caller's privileges.
-- Keep operational telemetry inaccessible to browser roles; server-side
-- service_role is the intended consumer.

alter view public.service_health_24h set (security_invoker = true);

revoke all on table public.service_health_24h from anon, authenticated;
revoke all on table public.service_metrics from anon, authenticated;

grant select on table public.service_health_24h to service_role;
grant select on table public.service_metrics to service_role;
