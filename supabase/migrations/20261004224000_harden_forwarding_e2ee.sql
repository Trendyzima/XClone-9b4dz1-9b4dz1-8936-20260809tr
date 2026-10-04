-- E2EE correction: ciphertext from one conversation must never be copied into another
-- conversation because each conversation has its own key material.
revoke execute on function public.testagram_forward_message(uuid,uuid) from authenticated;
revoke execute on function public.testagram_forward_message(uuid,uuid) from public,anon;
