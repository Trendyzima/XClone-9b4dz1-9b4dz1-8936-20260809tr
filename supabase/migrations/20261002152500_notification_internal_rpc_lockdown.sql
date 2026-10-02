revoke all on function public.create_domain_notification(uuid,text,uuid,uuid,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.enqueue_notification_delivery() from public,anon,authenticated;
revoke all on function public.notify_social_action_v2() from public,anon,authenticated;
