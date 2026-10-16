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
  if(status===400||status===401||status===403||status===404||status===405||status===406||status===410||status===422)return "public_timeline_unavailable";
  if(status===429)return "rate_limited";
  if(status!==null&&status>=500)return "remote_5xx";
  if(error.toLowerCase().includes("timeout")||error.toLowerCase().includes("abort"))return "timeout";
  return "network_or_contract";
};
const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const UNAVAILABLE_RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const backoff=(failureClass:string,attempts:number,retryAfter?:string|null)=>{
  if(failureClass==="public_timeline_unavailable")return UNAVAILABLE_RECHECK_INTERVAL_MS;
  if(failureClass==="rate_limited"){const n=Number(retryAfter);if(Number.isFinite(n)&&n>=0)return Math.min(Math.max(n*1000,60_000),SYNC_INTERVAL_MS);}
  return Math.min(SYNC_INTERVAL_MS,Math.max(60_000,30_000*Math.pow(2,Math.min(attempts,7))));
};

async function ensureInstances(){
  const actorDomains=await db.from("federated_actors").select("domain").not("domain","is",null).limit(1000);
  const domains=[...new Set([...SEED,...(actorDomains.data||[]).map((x:any)=>cleanDomain(String(x.domain||""))).filter((x:string)=>x&&x.includes("."))])].slice(0,80);
  if(domains.length) await db.from("federated_instances").upsert(domains.map(domain=>({domain,base_url:`https://${domain}`,provider:"activitypub"})),{onConflict:"domain",ignoreDuplicates:true});
}

function normalizeTimelineVisibility(value:any):string{
  const visibility=String(value||"").trim().toLowerCase();
  if(visibility==="private")return "followers";
  if(["public","unlisted","followers","direct"].includes(visibility))return visibility;
  // This function only imports statuses from the remote instance's public
  // timeline endpoint. Mastodon-compatible APIs may omit the field, so public
  // is the safe endpoint-derived default; explicit private/direct values win.
  return "public";
}

async function syncDomain(instance:any){
  const started=Date.now();
  const domain=cleanDomain(String(instance.domain));
  const now=new Date();
  await db.from("federated_instances").update({last_attempt_at:now.toISOString(),updated_at:now.toISOString()}).eq("id",instance.id);
  await db.from("fediverse_instance_sync_state").upsert({domain,last_attempt_at:now.toISOString(),updated_at:now.toISOString()},{onConflict:"domain"});
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
    const actor=String(
      acct.uri ||
      acct.pleroma?.ap_id ||
      acct.url ||
      (acct.username ? `https://${domain}/users/${encodeURIComponent(String(acct.username))}` : "") ||
      acct.id ||
      ""
    ).trim();
    const uri=String(s.uri||s.url||"");
    if(!uri)return null;
    return {
      uri,object_type:"Note",actor_uri:actor,instance_id:instanceRow,url:s.url||uri,
      content:String(s.content||""),summary:s.spoiler_text||null,
      published_at:s.created_at||null,updated_at:s.edited_at||s.created_at||null,
      sensitive:Boolean(s.sensitive),visibility:normalizeTimelineVisibility(s.visibility),in_reply_to_uri:s.in_reply_to_id?String(s.in_reply_to_id):null,
      quote_uri:s.quote_id?String(s.quote_id):null,attachments:Array.isArray(s.media_attachments)?s.media_attachments:[],
      tags:Array.isArray(s.tags)?s.tags:[],like_count:Number(s.favourites_count||0),
      announce_count:Number(s.reblogs_count||0),reply_count:Number(s.replies_count||0),
      quote_count:Number(s.quotes_count||0),view_count:Number(s.view_count||0),
      content_warning:s.spoiler_text||null,raw_object:s
    };
  }).filter(Boolean);
  let upsertedCount=0;
  if(rows.length){
    const stored=await db.from("federated_objects").upsert(rows,{onConflict:"uri",ignoreDuplicates:false}).select("id");
    if(stored.error)throw new Error(`database upsert failed: ${stored.error.message}`);
    upsertedCount=stored.data?.length ?? rows.length;
  }
  const successAt=new Date().toISOString();
  await db.from("federated_instances").update({
    software:"mastodon",public_timeline_available:true,last_success_at:successAt,last_failure_at:null,
    last_error:null,failure_class:null,consecutive_failures:0,backoff_until:null,next_sync_at:new Date(Date.now()+SYNC_INTERVAL_MS).toISOString(),
    last_fetched_at:successAt,updated_at:successAt
  }).eq("id",instanceRow);
  await db.from("fediverse_instance_sync_state").upsert({
    domain,last_attempt_at:successAt,last_synced_at:successAt,last_success_at:successAt,
    last_error:null,objects_fetched:statuses.length,objects_upserted:upsertedCount,duration_ms:Date.now()-started,updated_at:successAt
  },{onConflict:"domain"});
  const actorUpsert = await db.from("federated_actors").upsert(statuses.map((s:any)=>s.account||{}).map((a:any)=>{
    const actorUri=String(
      a.uri ||
      a.pleroma?.ap_id ||
      a.url ||
      (a.username ? `https://${domain}/users/${encodeURIComponent(String(a.username))}` : "") ||
      a.id ||
      ""
    ).trim();
    if(!actorUri || !actorUri.startsWith("https://"))return null;
    const username=String(a.username||"").trim() || actorUri.split("/").filter(Boolean).pop() || "unknown";
    return {
      actor_uri:actorUri,
      username,
      domain,
      display_name:String(a.display_name||"").trim() || username,
      bio:a.note||null,
      avatar_url:a.avatar||null,
      raw_actor:a,
      fetched_at:successAt,
      updated_at:successAt
    };
  }).filter(Boolean),{onConflict:"actor_uri",ignoreDuplicates:false});
  if(actorUpsert.error) console.warn("[federation-inbound] actor index update failed",actorUpsert.error.message);
  return {domain,status:200,stored:upsertedCount,fetched:statuses.length,durationMs:Date.now()-started};
}

async function recordFailure(instance:any,domain:string,msg:string,status:number|null,cls:string,attempts:number,next:Date){
  const now=new Date().toISOString();
  const instanceUpdate:any={
    last_failure_at:now,last_error:msg,failure_class:cls,
    consecutive_failures:attempts,backoff_until:next.toISOString(),next_sync_at:next.toISOString(),updated_at:now
  };
  // A timeout or remote 5xx does not prove a public timeline is unavailable.
  // Preserve the known-good flag so transient failures do not demote healthy
  // sources into the low-priority discovery queue.
  if(cls==="public_timeline_unavailable")instanceUpdate.public_timeline_available=false;
  await db.from("federated_instances").update(instanceUpdate).eq("id",instance.id);
  await db.from("fediverse_instance_sync_state").upsert({
    domain,last_attempt_at:now,last_error:msg,duration_ms:Date.now()-Number(instance._startedAt||Date.now()),updated_at:now
  },{onConflict:"domain"});
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"POST required"},405);
  if(WORKER_TOKEN && req.headers.get("x-federation-worker-token")!==WORKER_TOKEN)return json({error:"unauthorized"},401);
  const runStarted=Date.now();
  let runId:string|null=null;
  try{
    const run=await db.from("fediverse_ingestion_runs").insert({status:"running"}).select("id").single();
    if(run.error)throw run.error;
    runId=run.data.id;
    await ensureInstances();
    const now=Date.now();
    const dueNow=(rows:any[])=> (rows||[]).filter((i:any)=>!i.next_sync_at||Date.parse(i.next_sync_at)<=now);
    // Keep known-public instances ahead of the much larger discovered-instance
    // backlog. Without this priority, thousands of unverified instances can
    // starve healthy public timelines and make the home feed look stale.
    const {data:publicInstances,error:publicError}=await db.from("federated_instances")
      .select("id,domain,base_url,consecutive_failures,next_sync_at")
      .eq("public_timeline_available",true)
      .order("next_sync_at",{ascending:true,nullsFirst:true}).limit(24);
    if(publicError)throw publicError;
    const duePublic=dueNow(publicInstances).slice(0,24);
    // Probe only a small number of unknown/unavailable instances per cycle.
    // Known public sources get the bulk of the capacity; unsupported instances
    // are rechecked daily rather than every two hours.
    const {data:otherInstances,error:otherError}=await db.from("federated_instances")
      .select("id,domain,base_url,consecutive_failures,next_sync_at")
      .or("public_timeline_available.is.false,public_timeline_available.is.null")
      .order("next_sync_at",{ascending:true,nullsFirst:true}).limit(2);
    if(otherError)throw otherError;
    const dueOther=dueNow(otherInstances).slice(0,2);
    const due=[...duePublic,...dueOther];
    const results:any[]=[];
    // At most 26 instances per run, with bounded concurrency. The cron caller
    // now allows 120 seconds, enough for the eight-second remote HTTP deadline
    // across these batches without an unbounded burst against remote servers.
    const concurrency=6;
    for(let i=0;i<due.length;i+=concurrency){
      const batch=due.slice(i,i+concurrency);
      const settled=await Promise.all(batch.map(async(instance:any)=>{
        const started=Date.now();
        try{return await syncDomain({...instance,_startedAt:started});}
        catch(e){
          const msg=e instanceof Error?e.message:String(e),attempts=Number(instance.consecutive_failures||0)+1,cls=classify(null,msg),next=new Date(Date.now()+backoff(cls,attempts));
          await recordFailure({...instance,_startedAt:started},cleanDomain(String(instance.domain)),msg,null,cls,attempts,next);
          return {domain:instance.domain,status:"error",error:msg,class:cls,durationMs:Date.now()-started};
        }
      }));
      results.push(...settled);
      const completedSuccesses=results.filter(r=>r.status===200);
      const completedFailures=results.filter(r=>r.status!==200);
      const progress=await db.from("fediverse_ingestion_runs").update({
        domains_attempted:results.length,
        domains_succeeded:completedSuccesses.length,
        domains_failed:completedFailures.length,
        objects_fetched:completedSuccesses.reduce((n,r)=>n+Number(r.fetched||0),0),
        objects_upserted:completedSuccesses.reduce((n,r)=>n+Number(r.stored||0),0),
        duration_ms:Date.now()-runStarted
      }).eq("id",runId);
      if(progress.error)console.warn("[federation-inbound] progress update failed",progress.error.message);
    }
    const succeeded=results.filter(r=>r.status===200);
    const failed=results.filter(r=>r.status!==200);
    const fetched=succeeded.reduce((n,r)=>n+Number(r.fetched||0),0);
    const upserted=succeeded.reduce((n,r)=>n+Number(r.stored||0),0);
    const status=failed.length===0?"succeeded":succeeded.length>0?"partial":"failed";
    const completedAt=new Date().toISOString();
    await db.from("fediverse_ingestion_runs").update({
      completed_at:completedAt,status,domains_attempted:due.length,domains_succeeded:succeeded.length,
      domains_failed:failed.length,objects_fetched:fetched,objects_upserted:upserted,
      duration_ms:Date.now()-runStarted,error:failed.length?String(failed[0]?.error||"One or more federation instances failed"):null
    }).eq("id",runId);
    return json({
      ok:status!=="failed",runId,status,scheduled:due.length,domainsSucceeded:succeeded.length,
      domainsFailed:failed.length,objectsFetched:fetched,objectsUpserted:upserted,
      nextCycleAt:new Date(Date.now()+SYNC_INTERVAL_MS).toISOString(),at:completedAt,results
    },status==="failed"?500:200);
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    if(runId)await db.from("fediverse_ingestion_runs").update({completed_at:new Date().toISOString(),status:"failed",duration_ms:Date.now()-runStarted,error:msg}).eq("id",runId);
    console.error("[federation-inbound]",e);
    return json({ok:false,runId,error:msg},500);
  }
});