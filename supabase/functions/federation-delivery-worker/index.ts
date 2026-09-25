import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE= Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || (()=>{ try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default||"" } catch { return "" }})();
const db=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const PUBLIC="https://www.w3.org/ns/activitystreams#Public";
const CTX=["https://www.w3.org/ns/activitystreams","https://w3id.org/security/v1"];
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});

function b64(bytes:ArrayBuffer){return btoa(String.fromCharCode(...new Uint8Array(bytes)));}
function pemToBuffer(pem:string){const body=pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");const bin=atob(body);const b=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)b[i]=bin.charCodeAt(i);return b.buffer;}
async function sign(local:any,value:string){const key=await crypto.subtle.importKey("pkcs8",pemToBuffer(local.private_key_pem),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);return b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(value)));}
async function digest(body:string){return b64(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body)));}
async function actor(local:any,url:string){const r=await fetch(url,{headers:{Accept:'application/activity+json, application/ld+json;q=0.9, application/json;q=0.5',"User-Agent":"Testagram-Federation/5.0"}});const text=await r.text();if(!r.ok)throw Error("remote actor "+r.status+": "+text.slice(0,500));const a=JSON.parse(text);if(a.id!==url||!a.inbox||!a.publicKey?.publicKeyPem)throw Error("invalid remote actor contract");return a;}
async function remoteObject(url:string){const r=await fetch(url,{headers:{Accept:'application/activity+json, application/ld+json;q=0.9, application/json;q=0.5',"User-Agent":"Testagram-Federation/5.0"}});const text=await r.text();if(!r.ok)throw Error("remote object "+r.status+": "+text.slice(0,500));const ct=r.headers.get("content-type")||"";if(ct.includes("json"))return JSON.parse(text);const link=r.headers.get("link")||"";const m=link.match(/<([^>]+)>;[^,]*rel="?alternate"?[^,]*type="?application\/activity\+json"?/i);if(!m?.[1])throw Error("remote object has no ActivityPub representation");const a=await fetch(new URL(m[1],url),{headers:{Accept:"application/activity+json","User-Agent":"Testagram-Federation/5.0"}});return JSON.parse(await a.text());}
function targetActor(activity:any):string|null{
  const type=String(activity?.type||"");
  if(type==="Follow" && typeof activity.object==="string") return activity.object;
  if((type==="Like"||type==="Announce") && typeof activity.object==="string") return null;
  if(type==="Create"){
    const ir=typeof activity.object==="object" ? activity.object?.inReplyTo : null;
    if(typeof ir==="string") return null;
  }
  const candidates=[...(Array.isArray(activity?.to)?activity.to:[]),...(Array.isArray(activity?.cc)?activity.cc:[])];
  return candidates.find((x:any)=>typeof x==="string"&&/^https:\/\//.test(x)&&x!==PUBLIC&&!x.endsWith("/followers"))||null;
}
async function resolveInbox(activity:any):Promise<{inbox:string,actor:string}>{
  const direct=targetActor(activity);
  let actorUrl=direct;
  if(!actorUrl && typeof activity?.object==="string") {
    const obj=await remoteObject(activity.object);
    actorUrl=typeof obj?.attributedTo==="string"?obj.attributedTo:(typeof obj?.actor==="string"?obj.actor:null);
  }
  if(!actorUrl && typeof activity?.object==="object") {
    const ir=activity.object?.inReplyTo;
    if(typeof ir==="string"){const obj=await remoteObject(ir);actorUrl=typeof obj?.attributedTo==="string"?obj.attributedTo:null;}
  }
  if(!actorUrl) throw Error("Unable to resolve remote recipient actor");
  const cached=await db.from("federated_actors").select("inbox_url").eq("actor_uri",actorUrl).maybeSingle();
  if(cached.data?.inbox_url) return {inbox:String(cached.data.inbox_url),actor:actorUrl};
  const a=await actor(null,actorUrl);
  const inbox=String(a.endpoints?.sharedInbox||a.inbox||"");
  if(!inbox) throw Error("remote actor has no inbox");
  return {inbox,actor:actorUrl};
}
async function signedPost(local:any,url:string,body:string,modern=false){
  if(!url || typeof url!=="string") throw Error("signedPost received empty inbox URL");
  let u:URL;
  try { u=new URL(url); } catch(e) { throw Error("signedPost invalid inbox URL: "+String(url)); }
  const date=new Date().toUTCString(),d="SHA-256="+await digest(body);
  if(!modern){
    const lines=[`(request-target): post ${u.pathname}${u.search}`,`host: ${u.host}`,`date: ${date}`,`digest: ${d}`];
    const sig=await sign(local,lines.join("\n"));
    try {
    const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),10000);
    const response=await fetch(url,{method:"POST",headers:{Accept:'application/activity+json, application/ld+json;q=0.9', "Content-Type":'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',Date:date,Digest:d,Signature:`keyId="${local.actor_url}#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${sig}"`,"User-Agent":"Testagram-Federation/5.0"},body,signal:controller.signal}); clearTimeout(timeout); return response;
  } catch(e) { throw Error("signedPost legacy fetch failed: "+(e instanceof Error?e.message:String(e))); }
  }
  const created=Math.floor(Date.now()/1000),params=`("@method" "@target-uri" "host" "content-digest");created=${created};keyid="${local.actor_url}#main-key";alg="rsa-v1_5-sha256"`;
  const covered=`"@method": POST\n"@target-uri": ${u}\n"host": ${u.host}\n"content-digest": sha-256=:${await digest(body)}:`;
  const sig=await sign(local,`${covered}\n"@signature-params": ${params}`);
  return fetch(url,{method:"POST",headers:{Accept:'application/activity+json, application/ld+json;q=0.9',"Content-Type":'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',"Content-Digest":`sha-256=:${await digest(body)}:`,"Signature-Input":`sig1=${params}`,Signature:`sig1=:${sig}:`,"User-Agent":"Testagram-Federation/5.0"},body});
}
function backoff(attempt:number,retryAfter:string|null){const ra=retryAfter?Number.parseInt(retryAfter,10):NaN;if(Number.isFinite(ra)&&ra>=0)return Math.min(ra,86400);return Math.min(86400,30*Math.pow(2,Math.min(attempt,8)));}
async function processJob(job:any){
  const activity=job.activity_payload||{};
  const ar=await db.from("federated_activities").select("id,uri,actor_uri").eq("id",job.activity_id).maybeSingle();
  const activityId=ar.data?.uri||activity?.id||"";
  const activityRow=ar.data;
  const actorUri=activityRow?.actor_uri||activity.actor;
  const localUser=await db.from("activitypub_actors").select("user_id,actor_id").eq("actor_id",actorUri).maybeSingle();
  if(!localUser.data?.user_id)throw Error("local actor not found");
  const key=await db.from("activitypub_keys").select("private_key_pem,key_id").eq("user_id",localUser.data.user_id).maybeSingle();
  if(!key.data?.private_key_pem)throw Error("local signing key missing");
  const local={actor_url:actorUri,private_key_pem:key.data.private_key_pem,key_id:key.data.key_id};
  // Public standalone Create activities are already addressed to the remote
  // follower represented by this delivery row. They do not have an
  // inReplyTo target, so they must be delivered directly to job.target_inbox.
  // Replies/interactions retain the transport path because they need remote
  // object/actor resolution.
  const target = activity?.type==="Follow" ? activity?.object : (activity?.type==="Create" ? activity?.object?.inReplyTo : activity?.object);
  if(activity?.type==="Create" && !target && job.target_inbox){
    const body=JSON.stringify(activity);
    let response=await signedPost(local,String(job.target_inbox),body,false);
    if((response.status===400||response.status===401)&&response.status!==404) response=await signedPost(local,String(job.target_inbox),body,true);
    const responseText=(await response.text()).slice(0,1200);
    const attempt=Number(job.attempt_count||1);
    if(response.ok){
      const now=new Date().toISOString();
      await db.from("federation_deliveries").update({status:"delivered",attempt_count:attempt,last_attempt_at:now,delivered_at:now,locked_at:null,next_attempt_at:null,last_status_code:response.status,last_error:null,updated_at:now}).eq("id",job.id).eq("status","in_flight");
      await db.from("activitypub_outbox").update({delivered:true,attempts:attempt,next_attempt_at:null,last_error:null,updated_at:now}).eq("activity_id",activityId);
      if(activityRow?.id) await db.from("federated_activities").update({processing_state:"delivered",processing_attempts:attempt,processed_at:now,last_error:null,updated_at:now}).eq("id",activityRow.id);
      return {status:"delivered",activityId,remoteStatus:response.status};
    }
    const permanent=response.status===404||response.status===410||(response.status>=400&&response.status<500&&response.status!==401&&response.status!==403&&response.status!==429);
    const next=new Date(Date.now()+backoff(attempt,response.headers.get("retry-after"))*1000).toISOString();
    const state=permanent?"dead_letter":"retry";
    const now=new Date().toISOString();
    await db.from("federation_deliveries").update({status:state,attempt_count:attempt,last_attempt_at:now,locked_at:null,next_attempt_at:permanent?null:next,last_status_code:response.status,last_error:(`Remote inbox ${response.status}: ${responseText}`).slice(0,2000),updated_at:now}).eq("id",job.id).eq("status","in_flight");
    await db.from("activitypub_outbox").update({attempts:attempt,next_attempt_at:permanent?null:next,last_error:(`Remote inbox ${response.status}: ${responseText}`).slice(0,2000),updated_at:now}).eq("activity_id",activityId);
    if(activityRow?.id) await db.from("federated_activities").update({processing_state:state,processing_attempts:attempt,last_error:(`Remote inbox ${response.status}: ${responseText}`).slice(0,2000),updated_at:now}).eq("id",activityRow.id);
    return {status:state,activityId,remoteStatus:response.status};
  }
  if(typeof target!=="string" || !target.startsWith("https://")) throw Error("federation delivery has no valid remote ActivityPub target");
  const internalOrigin=Deno.env.get("SUPABASE_PUBLIC_URL")||"https://ffrhglgkukgsuhxenena.supabase.co";
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),12000);
  let transportResponse:Response;
  try {
    transportResponse=await fetch(internalOrigin+"/functions/v1/federation-transport",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+SERVICE,"x-federation-internal":SERVICE},
      body:JSON.stringify({operation:"deliver",user_id:localUser.data.user_id,target,activity}),
      signal:controller.signal
    });
  } catch(e) {
    clearTimeout(timeout);
    throw Error("federation-transport invocation failed: "+(e instanceof Error?e.message:String(e)));
  }
  clearTimeout(timeout);
  const transportText=(await transportResponse.text()).slice(0,4000);
  let transport:any={}; try{transport=JSON.parse(transportText);}catch{}
  if(!transportResponse.ok || transport?.ok===false) throw Error("federation-transport rejected delivery: "+transportText.slice(0,1200));
  const queueStatus=transport?.delivery?.queue?.status||transport?.delivery?.status||"queued";
  if(queueStatus==="delivered") {
    const now=new Date().toISOString();
    await db.from("federation_deliveries").update({status:"delivered",delivered_at:now,locked_at:null,next_attempt_at:null,last_error:null,last_status_code:200,updated_at:now}).eq("id",job.id).eq("status","in_flight");
    await db.from("activitypub_outbox").update({delivered:true,attempts:Number(job.attempt_count||1),next_attempt_at:null,last_error:null}).eq("activity_id",activityId);
    if(activityRow?.id) await db.from("federated_activities").update({processing_state:"delivered",processing_attempts:Number(job.attempt_count||1),processed_at:now,last_error:null}).eq("id",activityRow.id);
    return {status:"delivered",activityId,remoteStatus:200};
  }
  const outboxCheck=await db.from("activitypub_outbox").select("delivered,attempts").eq("activity_id",activityId).maybeSingle();
  if(outboxCheck.data?.delivered===true){
    const now=new Date().toISOString();
    await db.from("federation_deliveries").update({status:"delivered",delivered_at:now,locked_at:null,next_attempt_at:null,last_error:null,last_status_code:200,updated_at:now}).eq("id",job.id).eq("status","in_flight");
    if(activityRow?.id) await db.from("federated_activities").update({processing_state:"delivered",processing_attempts:Number(outboxCheck.data.attempts||job.attempt_count||1),processed_at:now,last_error:null}).eq("id",activityRow.id);
    return {status:"delivered",activityId,transport:queueStatus};
  }
  const retryAt=new Date(Date.now()+15000).toISOString(), now=new Date().toISOString();
  await db.from("federation_deliveries").update({status:"retry",locked_at:null,next_attempt_at:retryAt,last_error:"transport queued: "+queueStatus,updated_at:now}).eq("id",job.id).eq("status","in_flight");
  return {status:"retry",activityId,transport:queueStatus};
  let inbox=job.target_inbox;
  let remoteActor="";
  if(!inbox){const r=await resolveInbox(activity);inbox=r.inbox;remoteActor=r.actor;await db.from("federation_deliveries").update({target_inbox:inbox,instance_domain:new URL(inbox).hostname,updated_at:new Date().toISOString()}).eq("id",job.id);}
  const body=JSON.stringify(activity);
  let response=await signedPost(local,inbox,body,false);
  if((response.status===400||response.status===401)&&response.status!==404)response=await signedPost(local,inbox,body,true);
  const responseText=(await response.text()).slice(0,1200);
  const attempt=Number(job.attempt_count||0)+1;
  if(response.ok){
    const now=new Date().toISOString();
    await db.from("federation_deliveries").update({status:"delivered",attempt_count:attempt,last_attempt_at:now,delivered_at:now,locked_at:null,next_attempt_at:null,last_status_code:response.status,last_error:null,updated_at:now}).eq("id",job.id).eq("status","in_flight");
    await db.from("activitypub_outbox").update({delivered:true,attempts:attempt,next_attempt_at:null,last_error:null,updated_at:now}).eq("activity_id",activityId);
    if(activityRow?.id)await db.from("federated_activities").update({processing_state:"delivered",processing_attempts:attempt,processed_at:now,last_error:null,updated_at:now}).eq("id",activityRow.id);
    return {status:"delivered",activityId,remoteStatus:response.status};
  }
  const permanent=response.status===404||response.status===410||(response.status>=400&&response.status<500&&response.status!==401&&response.status!==403&&response.status!==429);
  const next=new Date(Date.now()+backoff(attempt,response.headers.get("retry-after"))*1000).toISOString();
  const state=permanent?"dead_letter":"retry";
  const now=new Date().toISOString();
  await db.from("federation_deliveries").update({status:state,attempt_count:attempt,last_attempt_at:now,locked_at:null,next_attempt_at:permanent?null:next,last_status_code:response.status,last_error:(`Remote inbox ${response.status}: ${responseText}`).slice(0,2000),updated_at:now}).eq("id",job.id).eq("status","in_flight");
  await db.from("activitypub_outbox").update({attempts:attempt,next_attempt_at:permanent?null:next,last_error:(`Remote inbox ${response.status}: ${responseText}`).slice(0,2000),updated_at:now}).eq("activity_id",activityId);
  if(activityRow?.id)await db.from("federated_activities").update({processing_state:state,processing_attempts:attempt,last_error:(`Remote inbox ${response.status}: ${responseText}`).slice(0,2000),updated_at:now}).eq("id",activityRow.id);
  return {status:state,activityId,remoteStatus:response.status};
}
async function main(req:Request){
  const token=req.headers.get("x-federation-worker-token")||"";
  const check=await db.rpc("verify_federation_worker_token",{candidate:token});
  if(check.error||check.data!==true)return json({error:"Unauthorized federation worker"},401);
  const body=await req.json().catch(()=>({}));
  const limit=Math.min(Math.max(Number(body.limit||20),1),50);
  const now=new Date().toISOString();
  const q=await db.from("federation_deliveries").select("*").in("status",["pending","retry"]).lte("next_attempt_at",now).order("next_attempt_at",{ascending:true}).limit(limit);
  if(q.error)throw q.error;
  const results=[];
  for(const candidate of q.data||[]){
    const claim=await db.from("federation_deliveries").update({status:"in_flight",attempt_count:Number(candidate.attempt_count||0)+1,locked_at:now,last_attempt_at:now,updated_at:now}).eq("id",candidate.id).in("status",["pending","retry"]).select("*").maybeSingle();
    if(claim.error||!claim.data)continue;
    results.push(await processJob({...claim.data,activity_payload:claim.data.activity_payload||candidate.activity_payload}).catch(async e=>{
      const message=e instanceof Error ? (e.stack || e.message) : String(e),attempt=Number(claim.data.attempt_count||1),next=new Date(Date.now()+backoff(attempt,null)*1000).toISOString();
      await db.from("federation_deliveries").update({status:"retry",locked_at:null,next_attempt_at:next,last_error:message.slice(0,2000),updated_at:new Date().toISOString()}).eq("id",claim.data.id).eq("status","in_flight");
      await db.from("activitypub_outbox").update({attempts:attempt,next_attempt_at:next,last_error:message.slice(0,2000),updated_at:new Date().toISOString()}).eq("activity_id",claim.data.activity_id);
      return {status:"retry",activityId:claim.data.activity_id,error:message};
    }));
  }
  return json({ok:true,processed:results.length,results});
}
Deno.serve(async req=>{if(req.method==="OPTIONS")return new Response(null,{status:204});if(req.method!=="POST")return json({error:"POST required"},405);try{return await main(req);}catch(e){console.error("[federation-delivery-worker]",e);return json({error:e instanceof Error?e.message:"worker failed"},500);}});
