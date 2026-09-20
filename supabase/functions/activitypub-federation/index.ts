import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const SECRET = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY")!;
const admin = createClient(URL_BASE, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const publicOrigin = (Deno.env.get("FEDERATION_PUBLIC_ORIGIN") || "https://testagram.site").replace(/\/$/, "");

const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...CORS,"Content-Type":"application/json; charset=utf-8"}});

function safeRemote(value:string): URL {
  const u=new URL(value);
  if(u.protocol!=="https:") throw new Error("REMOTE_HTTPS_REQUIRED");
  const h=u.hostname.toLowerCase();
  if(h==="localhost"||h.endsWith(".local")||h.endsWith(".internal")||/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)) throw new Error("REMOTE_HOST_BLOCKED");
  return u;
}
function stripHtml(v:string){return v.replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();}
function domainOf(uri:string){try{return new URL(uri).hostname}catch{return ""}}

async function authUser(req:Request){
 const h=req.headers.get("authorization")||""; if(!/^Bearer\s+/i.test(h)) throw new Error("AUTH_REQUIRED");
 const token=h.replace(/^Bearer\s+/i,"").trim(); const c=createClient(URL_BASE,ANON,{global:{headers:{Authorization:h}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await c.auth.getUser(token); if(error||!data.user) throw new Error("AUTH_INVALID"); return data.user;
}

async function lookupActor(handle:string){
 const n=handle.trim().replace(/^@/,""); const parts=n.split("@"); if(parts.length!==2) throw new Error("HANDLE_INVALID");
 const username=parts[0], domain=parts[1].toLowerCase(); safeRemote("https://"+domain);
 const wf=await fetch(`https://${domain}/.well-known/webfinger?resource=${encodeURIComponent("acct:"+username+"@"+domain)}`,{headers:{Accept:"application/jrd+json, application/json"}});
 if(!wf.ok) throw new Error("WEBFINGER_NOT_FOUND");
 const wd=await wf.json(); const link=Array.isArray(wd.links)?wd.links.find((x:any)=>x.rel==="self" && String(x.type||"").includes("activity")):null;
 const actorUrl=String(link?.href||""); if(!actorUrl) throw new Error("ACTOR_LINK_NOT_FOUND"); safeRemote(actorUrl);
 const ar=await fetch(actorUrl,{headers:{Accept:"application/activity+json, application/ld+json"}});
 if(!ar.ok) throw new Error("ACTOR_FETCH_FAILED");
 const actor=await ar.json();
 const row={actor_uri:actor.id||actorUrl,username:actor.preferredUsername||username,domain,display_name:actor.name||actor.preferredUsername||username,
  bio:actor.summary||"",avatar_url:actor.icon?.url||null,inbox_url:actor.inbox||null,outbox_url:actor.outbox||null,
  followers_url:actor.followers||null,following_url:actor.following||null,public_key_pem:actor.publicKey?.publicKeyPem||null,raw_actor:actor,fetched_at:new Date().toISOString(),updated_at:new Date().toISOString()};
 const {data,error}=await admin.from("federated_actors").upsert(row,{onConflict:"actor_uri"}).select("*").single(); if(error) throw error;
 await admin.from("federated_instances").upsert({domain,base_url:"https://"+domain,provider:"activitypub",last_fetched_at:new Date().toISOString()},{onConflict:"domain"});
 return data;
}

function statusRow(s:any, instanceId:string|null){
 const account=s.account||{};
 const actorUri=account.url||account.uri||s.actor?.id||"";
 const uri=s.uri||s.id; if(!uri) return null;
 return {uri,object_type:"Note",actor_uri:actorUri,instance_id:instanceId,url:s.url||uri,content:s.content||s.text||"",
  summary:s.spoiler_text||s.summary||null,published_at:s.created_at||s.published||new Date().toISOString(),updated_at:s.edited_at||s.updated_at||null,
  sensitive:Boolean(s.sensitive),in_reply_to_uri:s.in_reply_to_id||s.in_reply_to_uri||null,language_code:s.language||null,
  attachments:s.media_attachments||[],tags:s.tags||[],like_count:Number(s.favourites_count||0),announce_count:Number(s.reblogs_count||0),
  reply_count:Number(s.replies_count||0),raw_object:s,tombstone:false};
}
async function importTimeline(instance:string,limit:number){
 const u=safeRemote(instance); const domain=u.hostname; const base=u.origin;
 const res=await fetch(base+"/api/v1/timelines/public?limit="+Math.min(Math.max(limit,1),30)+"&local=true",{headers:{Accept:"application/json"}});
 if(!res.ok) throw new Error("TIMELINE_FETCH_FAILED_"+res.status);
 const data=await res.json(); const {data:inst}=await admin.from("federated_instances").upsert({domain,base_url:base,provider:"mastodon",last_fetched_at:new Date().toISOString()},{onConflict:"domain"}).select("id").single();
 const rows=(Array.isArray(data)?data:[]).map((s:any)=>statusRow(s,inst?.id)).filter(Boolean);
 if(rows.length) await admin.from("federated_objects").upsert(rows,{onConflict:"uri"});
 for(const s of (Array.isArray(data)?data:[])){if(s.account?.url) await admin.from("federated_actors").upsert({actor_uri:s.account.url,username:s.account.username||"",domain:s.account.acct?.split("@")[1]||domain,display_name:s.account.display_name||s.account.username,avatar_url:s.account.avatar||null,bio:s.account.note||"",raw_actor:s.account},{onConflict:"actor_uri"});}
 return rows;
}

function b64ToBytes(b64:string){const bin=atob(b64.replace(/\s/g,""));const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
function pemBytes(pem:string){return b64ToBytes(pem.replace(/-----[^-]+-----/g,""));}
async function importPrivate(pem:string){return crypto.subtle.importKey("pkcs8",pemBytes(pem),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);}

async function signedPost(inbox:string, activity:any, keyPem:string, keyId:string){
 const body=JSON.stringify(activity); const digestBytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body));
 const digest="SHA-256="+btoa(String.fromCharCode(...new Uint8Array(digestBytes)));
 const target=safeRemote(inbox); const date=new Date().toUTCString();
 const signing=`(request-target): post ${target.pathname||"/"}\nhost: ${target.host}\ndate: ${date}\ndigest: ${digest}`;
 const key=await importPrivate(keyPem); const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(signing));
 const signature=btoa(String.fromCharCode(...new Uint8Array(sig)));
 const response=await fetch(target,{method:"POST",headers:{"Content-Type":"application/activity+json","Accept":"application/activity+json","Date":date,"Digest":digest,
  "Signature":`keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`},body});
 if(!response.ok) throw new Error("REMOTE_INBOX_"+response.status);
}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 if(req.method!=="POST")return json({error:"POST_REQUIRED"},405);
 try{
  const user=await authUser(req); const input=await req.json(); const action=String(input.action||"");
  if(action==="lookup_actor"){return json({ok:true,actor:await lookupActor(String(input.handle||""))});}
  if(action==="import_timeline"){const rows=await importTimeline(String(input.instance||"https://mastodon.social"),Number(input.limit||20));return json({ok:true,imported:rows.length,items:rows});}
  if(action==="import_actor"){return json({ok:true,actor:await lookupActor(String(input.handle||""))});}
  if(["like","boost","reply"].includes(action)){
    const objectUri=String(input.object_url||""); if(!objectUri)throw new Error("OBJECT_REQUIRED");
    const {data:obj}=await admin.from("federated_objects").select("id,uri,actor_uri,raw_object").eq("uri",objectUri).maybeSingle();
    if(!obj)throw new Error("REMOTE_OBJECT_NOT_IMPORTED");
    const {data:actor}=await admin.from("activitypub_actors").select("id,actor_id").eq("user_id",user.id).maybeSingle();
    const {data:key}=await admin.from("activitypub_keys").select("key_id,private_key_pem").eq("user_id",user.id).maybeSingle();
    if(!actor||!key)throw new Error("LOCAL_ACTIVITYPUB_IDENTITY_NOT_READY");
    const remoteActorUrl=String(obj.actor_uri||obj.raw_object?.account?.url||""); if(!remoteActorUrl)throw new Error("REMOTE_ACTOR_MISSING");
    let inbox=String(obj.raw_object?.account?.inbox||obj.raw_object?.actor?.inbox||"");
    if(!inbox){const remote=await lookupActor("@"+String(obj.raw_object?.account?.username||"")+"@"+domainOf(remoteActorUrl)); inbox=String(remote.inbox_url||"");}
    if(!inbox)throw new Error("REMOTE_INBOX_MISSING");
    const actorId=(await admin.from("activitypub_actors").select("actor_id").eq("id",actor.id).single()).data?.actor_id;
    const activityId=actorId+"/activities/"+crypto.randomUUID();
    let activity:any;
    if(action==="like") activity={"@context":"https://www.w3.org/ns/activitystreams","id":activityId,"type":"Like","actor":actorId,"object":objectUri};
    else if(action==="boost") activity={"@context":"https://www.w3.org/ns/activitystreams","id":activityId,"type":"Announce","actor":actorId,"object":objectUri};
    else {const content=String(input.content||"").trim();if(!content||content.length>5000)throw new Error("REPLY_INVALID");const noteId=activityId+"/note";activity={"@context":"https://www.w3.org/ns/activitystreams","id":activityId,"type":"Create","actor":actorId,"object":{"id":noteId,"type":"Note","attributedTo":actorId,"content":content,"inReplyTo":objectUri,"to":[remoteActorUrl],"cc":[],"published":new Date().toISOString()}};}
    await signedPost(inbox,activity,key.private_key_pem,key.key_id);
    const {data:reaction,error}=await admin.from("federated_reactions").upsert({user_id:user.id,object_id:obj.id,object_uri:objectUri,reaction_type:action,content:input.content||null,remote_activity_id:activityId,delivered:true,delivery_error:null,updated_at:new Date().toISOString()},{onConflict:"user_id,object_uri,reaction_type"}).select("*").single();
    if(error)throw error; return json({ok:true,reaction});
  }
  if(action==="follow" || action==="unfollow"){
    const target=String(input.target||input.actor_url||"").trim();
    if(!target) throw new Error("TARGET_REQUIRED");
    const targetUrl=safeRemote(target);
    const actorUrl=targetUrl.toString();
    let remote=await admin.from("federated_actors").select("actor_uri,inbox_url,raw_actor").eq("actor_uri",actorUrl).maybeSingle();
    if(!remote.data) {
      const parsed=new URL(actorUrl);
      const wf=await fetch(parsed.origin+"/.well-known/webfinger?resource="+encodeURIComponent("acct:"+parsed.pathname.split("/").filter(Boolean).pop()+"@"+parsed.hostname),{headers:{Accept:"application/jrd+json, application/json"}});
      if(wf.ok){ const wd=await wf.json(); const link=Array.isArray(wd.links)?wd.links.find((x:any)=>x.rel==="self"&&String(x.type||"").includes("activity")):null; if(link?.href) { const ar=await fetch(String(link.href),{headers:{Accept:"application/activity+json, application/ld+json"}}); if(ar.ok){ const a=await ar.json(); remote={data:{actor_uri:String(a.id||link.href),inbox_url:String(a.inbox||""),raw_actor:a}} as any; await admin.from("federated_actors").upsert({actor_uri:remote.data.actor_uri,username:a.preferredUsername||"",domain:parsed.hostname,display_name:a.name||a.preferredUsername||"",bio:a.summary||"",avatar_url:a.icon?.url||null,inbox_url:a.inbox||null,outbox_url:a.outbox||null,followers_url:a.followers||null,following_url:a.following||null,public_key_pem:a.publicKey?.publicKeyPem||null,raw_actor:a,fetched_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"actor_uri"}); }}}}
    if(!remote.data?.inbox_url) throw new Error("REMOTE_INBOX_MISSING");
    const {data:local}=await admin.from("activitypub_actors").select("actor_id").eq("user_id",user.id).single();
    const {data:key}=await admin.from("activitypub_keys").select("key_id,private_key_pem").eq("user_id",user.id).single();
    if(!local||!key) throw new Error("LOCAL_ACTIVITYPUB_IDENTITY_NOT_READY");
    const existing=await admin.from("federated_relationships").select("*").eq("local_user_id",user.id).eq("remote_actor_uri",remote.data.actor_uri).eq("relationship","following").maybeSingle();
    if(action==="unfollow"){
      if(existing.data?.activity_id){
        const undoId=local.actor_id+"/activities/"+crypto.randomUUID();
        const undo={"@context":"https://www.w3.org/ns/activitystreams","id":undoId,"type":"Undo","actor":local.actor_id,"object":{"id":existing.data.activity_id,"type":"Follow","actor":local.actor_id,"object":remote.data.actor_uri}};
        await signedPost(remote.data.inbox_url,undo,key.private_key_pem,key.key_id);
      }
      await admin.from("federated_relationships").delete().eq("local_user_id",user.id).eq("remote_actor_uri",remote.data.actor_uri).eq("relationship","following");
      return json({ok:true,following:false,actor_uri:remote.data.actor_uri});
    }
    const activityId=local.actor_id+"/activities/"+crypto.randomUUID();
    const follow={"@context":"https://www.w3.org/ns/activitystreams","id":activityId,"type":"Follow","actor":local.actor_id,"object":remote.data.actor_uri};
    await signedPost(remote.data.inbox_url,follow,key.private_key_pem,key.key_id);
    const up=await admin.from("federated_relationships").upsert({local_user_id:user.id,remote_actor_uri:remote.data.actor_uri,relationship:"following",state:"pending",activity_id:activityId,remote_inbox_url:remote.data.inbox_url,remote_actor:remote.data.raw_actor||{},error:null,updated_at:new Date().toISOString()},{onConflict:"local_user_id,remote_actor_uri,relationship"}).select("*").single();
    if(up.error) throw up.error;
    return json({ok:true,following:true,state:"pending",actor_uri:remote.data.actor_uri,activity_id:activityId});
  }
  if(action==="publish"){
    const content=String(input.content||"").trim(); if(!content||content.length>5000)throw new Error("CONTENT_INVALID");
    const {data:actor}=await admin.from("activitypub_actors").select("actor_id").eq("user_id",user.id).single();
    const {data:key}=await admin.from("activitypub_keys").select("key_id,private_key_pem").eq("user_id",user.id).single();
    if(!actor||!key)throw new Error("LOCAL_ACTIVITYPUB_IDENTITY_NOT_READY");
    const id=actor.actor_id+"/statuses/"+crypto.randomUUID(); const activityId=actor.actor_id+"/activities/"+crypto.randomUUID();
    const note={"@context":"https://www.w3.org/ns/activitystreams","id":id,"type":"Note","attributedTo":actor.actor_id,"content":content,"published":new Date().toISOString(),"to":["https://www.w3.org/ns/activitystreams#Public"],"cc":[actor.actor_id+"/followers"]};
    await admin.from("federated_objects").upsert({uri:id,object_type:"Note",actor_uri:actor.actor_id,url:id,content,raw_object:note,published_at:note.published});
    await admin.from("activitypub_outbox").insert({local_user_id:user.id,activity_type:"Create",activity_id:activityId,payload:{...note,id:activityId},delivered:true});
    return json({ok:true,object:note});
  }
  throw new Error("UNSUPPORTED_ACTION");
 }catch(e){const m=e instanceof Error?e.message:"FEDERATION_FAILED";return json({ok:false,error:m},m.startsWith("AUTH_")?401:400);}
});