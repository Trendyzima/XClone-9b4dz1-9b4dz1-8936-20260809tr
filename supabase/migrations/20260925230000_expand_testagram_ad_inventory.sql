-- Expand native Testagram inventory so every public surface can request a real local campaign.
do $$
declare r record;
begin
 for r in select * from (values
 ('video-feed','video',640,360),('reels','video',640,360),('story','story',360,640),
 ('search','search',640,360),('post-detail','post',640,360),('community','community',640,360)
 ) as x(code,kind,width,height) loop
   if exists(select 1 from public.testagram_ad_slots where code=r.code) then
     update public.testagram_ad_slots set kind=r.kind,floor_cpm_micros=50000,enabled=true,width=r.width,height=r.height where code=r.code;
   else
     insert into public.testagram_ad_slots(id,code,kind,floor_cpm_micros,enabled,width,height)
     values(r.code,r.code,r.kind,50000,true,r.width,r.height);
   end if;
 end loop;
end $$;