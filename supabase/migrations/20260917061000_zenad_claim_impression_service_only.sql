-- Impression billing is server-side only. zenad-decision invokes this with service_role.
revoke execute on function public.zenad_claim_impression(text,text,text,text,uuid,uuid,uuid,bigint,jsonb,jsonb) from anon, authenticated;
grant execute on function public.zenad_claim_impression(text,text,text,text,uuid,uuid,uuid,bigint,jsonb,jsonb) to service_role;
