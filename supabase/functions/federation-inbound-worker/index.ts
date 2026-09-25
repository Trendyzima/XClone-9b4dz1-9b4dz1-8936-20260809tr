import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY")!;
const WORKER_TOKEN = Deno.env.get("FEDERATION_WORKER_TOKEN") || "";
const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const SEED = [
  "fosstodon.org","hachyderm.io","mastodon.world","mas.to","mstdn.social",
  "techhub.social","universeodon.com","social.coop","piaille.fr","ruhr.social",
  "mathstodon.xyz","mastodon.bida.im","mastodon.social","mastodon.online","infosec.exchange"
];

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const cleanDomain=(v:string)=>v.toLowerCase().trim().replace(/^https?:\/\//,"").replace(/\/$/,"").split("/")[0];
const classify=(status:number|null,error:string)=>{
  if(status===401||status===403||status===422)return "public_timeline_unavailable";
  if(status===429)return "rate_limited";
  if(status!==null&&status>=500)return "remote_5xx";
  if(error.toLowerCase().includes("timeout")||error.toLowerCase().includes("abort"))return "timeout";
  return "network_or_contract";
};
const backoff=(failureClass:string,attempts:number,retryAfter?:string|null)=>{
  if(failureClass==="public_timeline_unavailable")return 6*60*60*1000;
  if(failureClass==="rate_limited"){const n=Number(retryAfter);if(Number.isFinite(n)&&n>=0)return Math.min(n*1000,6*60*60*1000);}
  return Math.min(6*60*60*1000,Math.max(60_000,30_000*Math.pow(2,Math.min(attempts,7))));
};

async function ensureInstances(){
  const actorDomains=await db.from("federated_actors").select("domain").not("domain","is",null).limit(1000);
  const domains=[...new Set([...SEED,...(actorDomains.data||[]).map((x:any)=>cleanDomain(String(x.domain||""))).filter((x:string)=>x&&x.includes("."))])].slice(0,80);
  if(domains.length) await db.from("federated_instances").upsert(domains.map(domain=>({domain,base_url:`https://${domain}`,provider:"activitypub"})),{onConflict:"domain",ignoreDuplicates:true});
}

async function syncDomain(instance:any){
  const domain=cleanDomain(String(instance.domain));
  const now=new Date();
  await db.from("federated_instances").update({last_attempt_at:now.toISOString(),last_fetched_at:now.toISOString(),updated_at:now.toISOString()}).eq("id",instance.id);
  await db.from("fediverse_instance_sync_state").upsert({domain,last_synced_at:now.toISOString(),updated_at:now.toISOString()},{onConflict:"domain"});
  let response:Response;
  try{
    response=await fetch(`https://${domain}/api/v1/timelines/public?limit=40&local=false`,{
      headers:{Accept:"application/json","User-Agent":"Testagram-Federation/6.0"},
      signal:AbortSignal.timeout(8000)
    });
  }catch(e){
    const msg=e instanceof Error?e.message:String(e), cls=classify(null,msg), attempts=Number(instance.consecutive_failures||0)+1;
    const next=new Date(Date.now()+backoff(cls,attempts));
    await recordFailure(instance,domain,msg,null,cls,attempts,next); return {domain,status:"error",error:msg};
  }
  const text=await response.text();
  if(!response.ok){
    const msg=`HTTP ${response.status}: ${text.slice(0,500)}`,cls=classify(response.status,msg),attempts=Number(instance.consecutive_failures||0)+1;
    const next=new Date(Date.now()+backoff(cls,attempts,response.headers.get("retry-after")));
    await recordFailure(instance,domain,msg,response.status,cls,attempts,next); return {domain,status:response.status,error:msg,class:cls};
  }
  let statuses:any[];
  try{const parsed=JSON.parse(text);statuses=Array.isArray(parsed)?parsed:[];}catch(e){
    const msg="invalid JSON from public timeline",cls="network_or_contract",attempts=Number(instance.consecutive_failures||0)+1,next=new Date(Date.now()+backoff(cls,attempts));
    await recordFailure(instance,domain,msg,response.status,cls,attempts,next); return {domain,status:response.status,error:msg};
  }
  const instanceRow=instance.id;
  const rows=statuses.map((s:any)=>{
    const acct=s.account||{};
    const actor=String(acct.url||acct.uri||`https://${domain}/users/${acct.username||"unknown"}`);
    const uri=String(s.uri||s.url||"");
    if(!uri)return null;
    return {
      uri,object_type:"Note",actor_uri:actor,instance_id:instanceRow,url:s.url||uri,
      content:String(s.content||""),summary:s.spoiler_text||null,
      published_at:s.created_at||null,updated_at:s.edited_at||s.created_at||null,
      sensitive:Boolean(s.sensitive),in_reply_to_uri:s.in_reply_to_id?String(s.in_reply_to_id):null,
      quote_uri:s.quote_id?String(s.quote_id):null,attachments:Array.isArray(s.media_attachments)?s.media_attachments:[],
      tags:Array.isArray(s.tags)?s.tags:[],like_count:Number(s.favourites_count||0),
      announce_count:Number(s.reblogs_count||0),reply_count:Number(s.replies_count||0),
      quote_count:Number(s.quotes_count||0),view_count:Number(s.view_count||0),
      content_warning:s.spoiler_text||null,raw_object:s
    };
  }).filter(Boolean);
  if(rows.length){
    const stored=await db.from("federated_objects").upsert(rows,{onConflict:"uri",ignoreDuplicates:false});
    if(stored.error)throw new Error(`database upsert failed: ${stored.error.message}`);
  }
  const successAt=new Date().toISOString();
  await db.from("federated_instances").update({
    software:"mastodon",public_timeline_available:true,last_success_at:successAt,last_failure_at:null,
    last_error:null,failure_class:null,consecutive_failures:0,backoff_until:null,next_sync_at:new Date(Date.now()+2*60*1000).toISOString(),
    last_fetched_at:successAt,updated_at:successAt
  }).eq("id",instanceRow);
  await db.from("fediverse_instance_sync_state").upsert({
    domain,last_synced_at:successAt,last_success_at:successAt,last_error:null,updated_at:successAt
  },{onConflict:"domain"});
  const actorUpsert = await db.from("federated_actors").upsert(statuses.map((s:any)=>s.account||{}).map((a:any)=>{
    const actorUri=String(a.url||a.uri||""); if(!actorUri)return null;
    return {actor_uri:actorUri,username:String(a.username||"unknown"),domain,display_name:a.display_name||a.username||"unknown",bio:a.note||null,avatar_url:a.avatar||null,raw_actor:a,fetched_at:successAt,updated_at:successAt};
  }).filter(Boolean,{onConflict:"actor_uri",ignoreDuplicates:false}); if(actorUpsert.error) console.warn("[federation-inbound] actor index update failed",actorUpsert.error.message);
  return {domain,status:200,stored:rows.length};
}

async function recordFailure(instance:any,domain:string,msg:string,status:number|null,cls:string,attempts:number,next:Date){
  const now=new Date().toISOString();
  await db.from("federated_instances").update({
    last_failure_at:now,last_error:msg,failure_class:cls,public_timeline_available:cls==="public_timeline_unavailable"?false:null,
    consecutive_failures:attempts,backoff_until:next.toISOString(),next_sync_at:next.toISOString(),updated_at:now
  }).eq("id",instance.id);
  await db.from("fediverse_instance_sync_state").upsert({domain,last_synced_at:now,last_error:msg,updated_at:now},{onConflict:"domain"});
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"POST required"},405);
  if(WORKER_TOKEN && req.headers.get("x-federation-worker-token")!==WORKER_TOKEN)return json({error:"unauthorized"},401);
  try{
    await ensureInstances();
    const {data:instances,error}=await db.from("federated_instances").select("id,domain,base_url,consecutive_failures,next_sync_at").order("next_sync_at",{ascending:true,nullsFirst:true}).limit(80);
    if(error)throw error;
    const now=Date.now();
    const due=(instances||[]).filter((i:any)=>!i.next_sync_at||Date.parse(i.next_sync_at)<=now).slice(0,12);
    const results=[];
    for(const instance of due){try{results.push(await syncDomain(instance));}catch(e){
      const msg=e instanceof Error?e.message:String(e),attempts=Number(instance.consecutive_failures||0)+1,cls=classify(null,msg),next=new Date(Date.now()+backoff(cls,attempts));
      await recordFailure(instance,cleanDomain(String(instance.domain)),msg,null,cls,attempts,next);results.push({domain:instance.domain,status:"error",error:msg,class:cls});
    }}
    return json({ok:true,scheduled:due.length,results,at:new Date().toISOString()});
  }catch(e){console.error("[federation-inbound]",e);return json({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
