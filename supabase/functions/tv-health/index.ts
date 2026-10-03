import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Content-Type":"application/json; charset=utf-8"};
const timeoutMs=2500;
async function probe(url:string){
 const started=Date.now(); const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const r=await fetch(url,{method:"GET",redirect:"follow",signal:controller.signal,headers:{"User-Agent":"TestagramTV-Health/1.0","Accept":"application/vnd.apple.mpegurl,application/x-mpegURL,video/*,audio/*,*/*","Range":"bytes=0-2047"}});
  const type=(r.headers.get("content-type")||"").toLowerCase();
  let ok=r.ok||r.status===206;
  if(ok && /mpegurl|m3u/.test(type)){const body=await r.text();ok=/#EXTM3U|#EXTINF|#EXT-X-/.test(body);}
  return {ok,latency:Date.now()-started,error:ok?null:"HTTP "+r.status};
 }catch(e){return {ok:false,latency:Date.now()-started,error:e instanceof Error?e.message:"probe failed"}}
 finally{clearTimeout(timer)}
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 const supplied=req.headers.get("apikey")||req.headers.get("authorization")?.replace(/^Bearer\\s+/i,"");
 const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!serviceKey || supplied!==serviceKey) return new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:cors});
 const body=await req.json().catch(()=>({}));
 const channels=Array.isArray(body.channels)?body.channels: [];
 const batch=channels.slice(0,Number(body.limit||100));
 const results:any[]=[]; let cursor=0;
 const worker=async()=>{while(cursor<batch.length){const c=batch[cursor++]; if(!c?.url)continue; const p=await probe(String(c.url)); results.push({channel_id:String(c.id),...p});}};
 await Promise.all(Array.from({length:Math.min(12,batch.length||1)},worker));
 for(const r of results){
  const c=batch.find((x:any)=>String(x.id)===r.channel_id); if(!c)continue;
  const existing=await supabase.from("tv_channel_health").select("consecutive_failures,consecutive_successes,last_online_at").eq("channel_id",r.channel_id).maybeSingle();
  const old=existing.data||{};
  await supabase.from("tv_channel_health").upsert({
   channel_id:r.channel_id,url:String(c.url),is_online:r.ok,last_checked_at:new Date().toISOString(),
   last_online_at:r.ok?new Date().toISOString():old.last_online_at||null,
   consecutive_failures:r.ok?0:Number(old.consecutive_failures||0)+1,
   consecutive_successes:r.ok?Number(old.consecutive_successes||0)+1:0,
   latency_ms:r.latency,check_error:r.error,source:c.source||null,country:c.country||null,
   group_name:c.group||null,priority:Number(c.priority||0)
  },{onConflict:"channel_id"});
 }
 return new Response(JSON.stringify({ok:true,checked:results.length,online:results.filter(x=>x.ok).length,offline:results.filter(x=>!x.ok).length,checked_at:new Date().toISOString()}),{headers:cors});
});