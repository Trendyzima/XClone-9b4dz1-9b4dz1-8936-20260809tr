import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const MAX_RESPONSE_BYTES=1500000,TIMEOUT_MS=12000;
function private4(ip:string){const p=ip.split(".").map(Number);if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return true;const[a,b]=p;return a===0||a===10||a===127||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===0||b===168))||(a===198&&(b===18||b===19))||a>=224;}
function private6(ip:string){const x=ip.toLowerCase().split("%")[0];if(x==="::"||x==="::1"||x.startsWith("fc")||x.startsWith("fd")||x.startsWith("fe8")||x.startsWith("fe9")||x.startsWith("fea")||x.startsWith("feb")||x.startsWith("ff"))return true;const m=x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);return !!m&&private4(m[1]);}
async function publicDns(host:string){if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal"))throw Error("private federation hostname");if(/^\d+\.\d+\.\d+\.\d+$/.test(host)&&private4(host))throw Error("private federation address");const ips=[...(await Deno.resolveDns(host,"A").catch(()=>[] as string[])),...(await Deno.resolveDns(host,"AAAA").catch(()=>[] as string[]))];if(!ips.length)throw Error("federation DNS did not resolve");for(const ip of ips)if(ip.includes(":")?private6(ip):private4(ip))throw Error("federation DNS resolves to private address");}
async function federationFetch(input:string){const u=new URL(input);if(u.protocol!=="https:"||u.username||u.password)throw Error("federation URL must be HTTPS without credentials");await publicDns(u.hostname);const c=new AbortController(),t=setTimeout(()=>c.abort(),TIMEOUT_MS);try{const r=await fetch(u,{headers:{Accept:"application/activity+json, application/ld+json;q=0.9, application/json;q=0.5"},signal:c.signal,redirect:"manual"});if(r.status>=300&&r.status<400){const loc=r.headers.get("location");if(!loc)throw Error("federation redirect missing location");return federationFetch(new URL(loc,u).toString());}return r;}finally{clearTimeout(t);}}
async function federationJson(input:string){const r=await federationFetch(input);if(!r.ok)throw Error(`federation fetch failed: ${r.status}`);const raw=await r.text();if(raw.length>MAX_RESPONSE_BYTES)throw Error("federation response too large");return JSON.parse(raw);}
function actorKeyMatches(actor:any,actorUri:string){const key=actor?.publicKey;return ["Person","Service","Organization","Group","Application"].includes(actor?.type)&&actor?.id===actorUri&&typeof key?.publicKeyPem==="string"&&key.publicKeyPem.includes("BEGIN PUBLIC KEY")&&(!key.id||key.id.startsWith(actorUri+"#"));}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const AP = "https://www.w3.org/ns/activitystreams";
const CORS = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"accept,content-type,date,digest,signature,signature-input,content-digest,host,x-testagram-edge-verified,x-testagram-verified-actor,authorization,apikey",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{...CORS,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const str=(v:unknown)=>typeof v==="string"?v:"";
const uri=(v:unknown)=>typeof v==="string"?v:v&&typeof v==="object"?str((v as any).id):"";
const b64=(b:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(b)));
const ub64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const pem=(s:string)=>ub64(s.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,""));
function parts(v:string){const o:any={};for(const p of v.split(/,(?=\w+=)/)){const i=p.indexOf("=");if(i>0)o[p.slice(0,i).trim()]=p.slice(i+1).trim().replace(/^"|"$/g,"")}return o;}
async function verifyLegacy(req:Request,raw:string,actor:string){
  const sig=req.headers.get("signature"),digest=req.headers.get("digest"),date=req.headers.get("date");
  if(!sig||!digest||!date)throw Error("missing HTTP signature headers");
  const when=Date.parse(date);if(!Number.isFinite(when)||Math.abs(Date.now()-when)>60*60*1000)throw Error("stale Date header");
  const expected="SHA-256="+b64(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw)));
  if(digest.toLowerCase()!==expected.toLowerCase())throw Error("digest mismatch");
  const p=parts(sig);if(!p.signature||!p.keyId||!p.headers)throw Error("unsupported HTTP signature");
  if(p.keyId.split("#")[0]!==actor)throw Error("signature key owner mismatch");
  const a=await federationJson(actor);if(!actorKeyMatches(a,actor))throw Error("remote actor key invalid");
  const key=await crypto.subtle.importKey("spki",pem(a.publicKey.publicKeyPem),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const u=new URL(req.url),lines:string[]=[];
  for(const h of p.headers.toLowerCase().split(/\s+/).filter(Boolean)){
    if(h==="(request-target)")lines.push(`(request-target): ${req.method.toLowerCase()} ${u.pathname}${u.search}`);
    else if(h==="host")lines.push(`host: ${u.host}`);
    else {const v=req.headers.get(h);if(v===null)throw Error(`signed header missing: ${h}`);lines.push(`${h}: ${v}`);}
  }
  if(!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,ub64(p.signature),new TextEncoder().encode(lines.join("\n"))))throw Error("HTTP signature invalid");
}
async function verifyRfc9421(req:Request,raw:string,actor:string){
  const input=req.headers.get("signature-input"),sig=req.headers.get("signature"),digest=req.headers.get("content-digest");
  if(!input||!sig||!digest)throw Error("missing RFC9421 headers");
  const m=input.match(/^sig1=(\([^)]*\))(.*)$/);if(!m)throw Error("malformed Signature-Input");
  const comps=[...m[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
  const params=m[1]+m[2],created=Number(m[2].match(/;created=(\d+)/)?.[1]||0),keyId=m[2].match(/;keyid="([^"]+)"/)?.[1]||"",alg=m[2].match(/;alg="([^"]+)"/)?.[1]||"";
  if(alg!=="rsa-v1_5-sha256"||keyId.split("#")[0]!==actor||!created||Math.abs(Date.now()/1000-created)>300||!comps.includes("@method")||!comps.includes("@target-uri")||!comps.includes("content-digest"))throw Error("invalid RFC9421 signature parameters");
  const dm=digest.match(/^sha-256=:([^:]+):$/i),sm=sig.match(/^sig1=:([^:]+):$/);if(!dm||!sm)throw Error("invalid RFC9421 digest/signature");
  const expected=b64(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw)));if(dm[1]!==expected)throw Error("Content-Digest mismatch");
  const a=await federationJson(actor);if(!actorKeyMatches(a,actor))throw Error("remote actor key invalid");
  const key=await crypto.subtle.importKey("spki",pem(a.publicKey.publicKeyPem),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const target=new URL(req.url).toString();
  const base=`"@method": ${req.method}\n"@target-uri": ${target}\n"content-digest": ${digest}\n"@signature-params": ${params}`;
  if(!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,ub64(sm[1]),new TextEncoder().encode(base)))throw Error("RFC9421 signature invalid");
}
async function verify(req:Request,raw:string,actor:string){if(req.headers.get("signature-input"))return verifyRfc9421(req,raw,actor);return verifyLegacy(req,raw,actor);}
function localActorForTarget(target:string){return db.from("activitypub_actors").select("user_id,actor_id").eq("actor_id",target).maybeSingle();}
async function cacheRemoteActor(actorUri:string,doc:any){
  const u=new URL(actorUri);
  await db.from("federated_actors").upsert({
    actor_uri:actorUri,username:str(doc.preferredUsername)||actorUri.split("/").filter(Boolean).pop()||"remote",
    domain:u.hostname,display_name:str(doc.name)||null,bio:str(doc.summary)||null,
    avatar_url:uri(doc.icon)||null,inbox_url:uri(doc.inbox)||null,outbox_url:uri(doc.outbox)||null,
    followers_url:uri(doc.followers)||null,following_url:uri(doc.following)||null,
    public_key_pem:str(doc.publicKey?.publicKeyPem)||null,raw_actor:doc,
    fetched_at:new Date().toISOString(),updated_at:new Date().toISOString()
  },{onConflict:"actor_uri"});
}
async function signAccept(local:any,key:any,inbox:string,activity:any){
  const payload=JSON.stringify(activity);
  const target=new URL(inbox),date=new Date().toUTCString();
  const digest="SHA-256="+b64(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(payload)));
  const lines=[`(request-target): post ${target.pathname}${target.search}`,`host: ${target.host}`,`date: ${date}`,`digest: ${digest}`];
  const body=key.private_key_pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");
  const binary=atob(body),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  const cryptoKey=await crypto.subtle.importKey("pkcs8",bytes.buffer,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const sig=b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",cryptoKey,new TextEncoder().encode(lines.join("\n")))));
  return fetch(inbox,{method:"POST",headers:{
    Accept:'application/activity+json, application/ld+json;q=0.9',
    "Content-Type":'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
    Date:date,Digest:digest,
    Signature:`keyId="${local.actor_id}#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${sig}"`,
    "User-Agent":"Testagram-Federation/4.0"
  },body:payload});
}
async function processActivity(activity:any,actor:string){
  const type=str(activity.type),id=str(activity.id)||`urn:testagram:inbound:${crypto.randomUUID()}`;
  const objectUri=uri(activity.object);
  if(type==="Follow"&&objectUri){
    const local=await localActorForTarget(objectUri);
    if(local.data?.user_id){
      const actorDoc=await federationJson(actor);await cacheRemoteActor(actor,actorDoc);
      const existing=await db.from("federated_follow_relationships").select("id,state").eq("local_user_id",local.data.user_id).eq("remote_actor_uri",actor).eq("direction","follower").maybeSingle();
      if(existing.error)throw existing.error;
      if(existing.data?.state==="active")return;
      const {data:key}=await db.from("activitypub_keys").select("private_key_pem,key_id").eq("user_id",local.data.user_id).maybeSingle();
      if(!key?.private_key_pem)throw Error("Local ActivityPub signing key not found");
      const accept={"@context":[AP,"https://w3id.org/security/v1"],id:`${local.data.actor_id}/activities/${crypto.randomUUID()}`,type:"Accept",actor:local.data.actor_id,object:activity,to:[actor]};
      const inbox=uri(actorDoc.endpoints?.sharedInbox)||uri(actorDoc.inbox);
      if(!inbox)throw Error("Remote actor inbox missing");
      const response=await signAccept(local.data,key,inbox,accept);
      if(!response.ok)throw Error(`Accept delivery failed: ${response.status}`);
      await db.from("federated_follow_relationships").upsert({
        local_user_id:local.data.user_id,remote_actor_uri:actor,direction:"follower",state:"active",
        follow_activity_uri:id,remote_inbox_uri:inbox,delivery_state:"delivered",delivery_attempts:1,last_error:null
      },{onConflict:"local_user_id,remote_actor_uri,direction"});
      return;
    }
  }
  if(type==="Accept"||type==="Reject"){
    const f=activity.object||{};if(str(f.type)==="Follow"){
      const follower=uri(f.actor),target=uri(f.object);const local=await localActorForTarget(follower);
      if(local.data?.user_id&&target){
        await db.from("federated_follow_relationships").update({state:type==="Accept"?"active":"failed",delivery_state:type==="Accept"?"delivered":"failed",updated_at:new Date().toISOString()})
          .eq("local_user_id",local.data.user_id).eq("remote_actor_uri",target).eq("direction","following");
      }
    }
    return;
  }
  if(type==="Undo"){
    const f=activity.object||{};if(str(f.type)==="Follow"){
      const target=uri(f.object);const local=target?await localActorForTarget(target):null;
      if(local?.data?.user_id)await db.from("federated_follow_relationships").update({state:"failed",delivery_state:"failed",last_error:"Remote actor sent Undo Follow",updated_at:new Date().toISOString()}).eq("local_user_id",local.data.user_id).eq("remote_actor_uri",actor).eq("direction","follower");
    }
    return;
  }
  if(["Create","Update","Delete","Like","Announce"].includes(type)){
    const object=activity.object&&typeof activity.object==="object"?activity.object:null;
    const objectId=uri(object)||str(activity.object);
    if(type==="Create"&&objectId&&object){
      await db.from("federated_objects").upsert({uri:objectId,object_type:str(object.type)||"Object",actor_uri:actor,url:uri(object.url)||objectId,content:str(object.content)||null,summary:str(object.summary)||null,published_at:str(object.published)||null,updated_at:str(object.updated)||null,sensitive:Boolean(object.sensitive),attachments:Array.isArray(object.attachment)?object.attachment:[],tags:Array.isArray(object.tag)?object.tag:[],raw_object:object},{onConflict:"uri"});
    }
    if(type==="Delete"&&objectId)await db.from("federated_objects").update({deleted_at:new Date().toISOString(),tombstone:true}).eq("uri",objectId).eq("actor_uri",actor);
  }
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(req.method!=="POST")return json({error:"POST required"},405);
  try{
    const ct=req.headers.get("content-type")||"";if(!/(activity\+json|ld\+json|application\/json)/i.test(ct))return json({error:"Unsupported ActivityPub content type"},415);
    const raw=await req.text();if(!raw||raw.length>2_000_000)return json({error:"Invalid activity body"},400);
    const activity=JSON.parse(raw),actor=uri(activity.actor),id=str(activity.id)||`urn:testagram:inbound:${crypto.randomUUID()}`;
    if(!actor.startsWith("https://")||!str(activity.type))return json({error:"Activity type and HTTPS actor are required"},400);
    const edge=req.headers.get("x-testagram-edge-verified")==="true";
    if(edge){
      const credential=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim()||(req.headers.get("apikey")||"").trim();
      if(!SERVICE||credential!==SERVICE||req.headers.get("x-testagram-verified-actor")!==actor)return json({error:"Invalid edge verification"},401);
    }else await verify(req,raw,actor);
    const duplicate=await db.from("activitypub_inbox").select("id").eq("payload->>id",id).maybeSingle();
    if(duplicate.data)return new Response(null,{status:202,headers:CORS});
    const target=uri(activity.object)||uri(activity.target)||actor;
    const local=await localActorForTarget(target);
    if(!local.data?.user_id&&activity.type!=="Create"&&activity.type!=="Update"&&activity.type!=="Delete")return json({error:"Activity target is not a local Testagram actor"},404);
    await db.from("activitypub_inbox").insert({local_user_id:local.data?.user_id,activity_type:str(activity.type),actor_url:actor,object_url:uri(activity.object)||null,payload:activity,processed:false});
    await processActivity(activity,actor);
    await db.from("activitypub_inbox").update({processed:true}).eq("payload->>id",id);
    return new Response(null,{status:202,headers:CORS});
  }catch(e){console.error("[federation-inbox]",e);return json({error:e instanceof Error?e.message:"Malformed ActivityPub request"},401);}
});