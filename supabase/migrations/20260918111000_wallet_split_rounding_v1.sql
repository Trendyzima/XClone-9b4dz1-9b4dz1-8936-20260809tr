create or replace function public.wallet_create_split(p_total numeric,p_recipient_ids uuid[],p_note text default null) returns uuid language plpgsql security invoker set search_path='' as $$
declare w public.wallets%rowtype; sid uuid:=gen_random_uuid(); n int; i int:=0; per numeric; r uuid; amt numeric;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 n:=coalesce(array_length(p_recipient_ids,1),0);
 if p_total<=0 or n<1 or n>5 then raise exception 'INVALID_SPLIT'; end if;
 if exists(select 1 from unnest(p_recipient_ids) x where x=auth.uid()) then raise exception 'INVALID_RECIPIENT'; end if;
 if (select count(distinct x) from unnest(p_recipient_ids) x)<>n then raise exception 'DUPLICATE_RECIPIENT'; end if;
 select * into w from public.wallets where user_id=auth.uid() for update;
 if not found or w.balance<p_total then raise exception 'INSUFFICIENT_BALANCE'; end if;
 per:=round(p_total/n,2);
 insert into public.wallet_splits(id,wallet_id,user_id,total_amount,recipient_count,note) values(sid,w.id,auth.uid(),p_total,n,p_note);
 foreach r in array p_recipient_ids loop
   i:=i+1; amt:=case when i=n then p_total-per*(n-1) else per end;
   perform public.p2p_wallet_transfer(auth.uid(),r,amt,p_note);
   insert into public.wallet_split_recipients(split_id,recipient_user_id,amount) values(sid,r,amt);
 end loop;
 return sid;
end $$;