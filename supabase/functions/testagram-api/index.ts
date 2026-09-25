import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";const ANON=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";const FEED=`${SUPABASE_URL}/functions/v1/feed-fast`;const POST_CREATE=`${SUPABASE_URL}/functions/v1/post-create`;const TRANSPORT=`${SUPABASE_URL}/functions/v1/federation-transport`;const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-supabase-api-version","Access-Control-Allow-Methods":"GET,POST,DELETE,OPTIONS"};const admin=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{...CORS,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
async function user(auth:string|null){
  if(!auth)return null;
  const token=auth.replace(/^Bearer\\s+/i,"").trim();
  if(!token)return null;
  try {
    const r=await admin.auth.getUser(token);
    if(r.data?.user?.id)return r.data.user;
  } catch(e) { console.warn("service auth lookup failed",e); }
  if(!ANON)return null;
  try {
    const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:ANON,Authorization:auth}});
    if(!r.ok)return null;
    const u=await r.json();
    return u?.id?u:null;
  } catch { return null; }
}
async function fn(target:string,method:string,body:unknown,auth:string|null,params:Record<string,string>={}){const u=new URL(target);for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);const r=await fetch(u,{method,headers:{"Content-Type":"application/json",...(auth?{Authorization:auth}:{})},body:["GET","HEAD"].includes(method)?undefined:JSON.stringify(body??{})});const t=await r.text();return new Response(t,{status:r.status,headers:{...CORS,"Content-Type":r.headers.get("Content-Type")||"application/json; charset=utf-8","Cache-Control":"no-store"}})}
async function transport(body:any){const r=await fetch(TRANSPORT,{method:"POST",headers:{"Content-Type":"application/json","x-federation-internal":SERVICE},body:JSON.stringify(body)});const t=await r.text();return{status:r.status,data:()=>{try{return JSON.parse(t)}catch{return{error:t}}}}}
async function localProfile(username:string){const r=await admin.from("profiles").select("*").eq("username",username).maybeSingle();return r.data}
async function localActor(username:string){const p=await localProfile(username);if(!p)return null;const a=await admin.from("activitypub_actors").select("*").eq("user_id",p.id).maybeSingle();if(!a.data)return null;const k=await admin.from("activitypub_keys").select("public_key_pem,key_id").eq("user_id",p.id).maybeSingle();if(!k.data)return null;const id=a.data.actor_id;return {"@context":["https://www.w3.org/ns/activitystreams","https://w3id.org/security/v1"],id,type:"Person",preferredUsername:p.username,name:p.display_name||p.username,summary:p.bio||"",url:`https://www.testagram.site/profile/${encodeURIComponent(p.username)}`,icon:p.avatar_url?{type:"Image",url:p.avatar_url}:undefined,image:p.cover_url?{type:"Image",url:p.cover_url}:undefined,inbox:a.data.inbox_url,outbox:`${id}/outbox`,followers:`${id}/followers`,following:`${id}/following`,manuallyApprovesFollowers:Boolean(p.protected_account),publicKey:{id:`${id}#main-key`,owner:id,publicKeyPem:k.data.public_key_pem||""}}}
async function localTarget(value:string){const v=String(value||"").trim().replace(/^@/,"");if(/^https?:\/\//i.test(v))return null;if(v.includes("@"))return null;return localProfile(v)}
async function localPost(id:string){return (await admin.from("posts").select("*,author:profiles!posts_author_id_fkey(*)").eq("id",id).is("deleted_at",null).maybeSingle()).data}
async function replyOp(body:any,auth:string|null){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(body.post_id||body.postId||"").trim();
  const content=String(body.content||"").trim();
  const parentReplyId=String(body.parent_reply_id||body.parentReplyId||"").trim()||null;
  if(!target||!content)return json({error:"post_id and content required"},400);
  if(!/^https:\/\//i.test(target)){
    const r=await admin.from("replies").insert({post_id:target,user_id:u.id,content,...parentReplyId?{parent_reply_id:parentReplyId}:{}}).select("id,post_id,user_id,content,created_at,updated_at").single();
    if(r.error)return json({error:r.error.message},400);
    const count=await admin.from("posts").select("replies_count").eq("id",target).single();
    if(count.data) await admin.from("posts").update({replies_count:Number(count.data.replies_count||0)+1,updated_at:new Date().toISOString()}).eq("id",target);
    return json({reply_id:r.data?.id,created:true,replies_count:Number(count.data?.replies_count||0)+1},200);
  }
  // target is the thread root. When replying to another remote reply, the
  // parent ActivityPub object is the delivery target and inReplyTo. Keeping
  // object_uri on the ledger equal to the parent URI makes nested replies
  // independently readable through the same federated-replies endpoint.
  const parentUri=parentReplyId || target;
  const localReply=await admin.from("federated_replies").insert({
    user_id:u.id, object_uri:parentUri, parent_uri:parentUri, content, delivery_state:"pending"
  }).select("id,object_uri,parent_uri,content,created_at,delivery_state").single();
  if(localReply.error)return json({error:"Failed to persist federated reply",details:localReply.error.message},500);
  const activity:any={
    "@context":["https://www.w3.org/ns/activitystreams"],
    type:"Create",
    object:{
      type:"Note",
      content,
      inReplyTo:parentUri,
      to:["https://www.w3.org/ns/activitystreams#Public"]
    }
  };
  try {
    const r=await transport({user_id:u.id,operation:"deliver",target:parentUri,activity});
    const data=r.data();
    const activityId=data?.activity?.id ?? null;
    const replyObjectUri=data?.activity?.object?.id ?? data?.activity?.object?.url ?? null;
    await admin.from("federated_replies").update({
      activity_uri:activityId,
      reply_object_uri:replyObjectUri,
      delivery_state:(data?.delivery?.status==="delivered"||data?.delivery?.status==="queued")?"delivered":"pending",
      updated_at:new Date().toISOString()
    }).eq("id",localReply.data.id);
    return json({...data,ok:true,accepted:data?.accepted===true||data?.delivery?.status==="delivered"||data?.delivery?.status==="queued",status:data?.status||"pending",reply_id:localReply.data.id,reply:localReply.data},200);
  } catch (error) {
    console.warn("federated reply delivery pending", error);
    await admin.from("federated_replies").update({delivery_state:"pending",updated_at:new Date().toISOString()}).eq("id",localReply.data.id);
    return json({
      ok:true, accepted:false, supported:true, status:"pending", queued:true,
      reply_id:localReply.data.id, reply:localReply.data,
      error:error instanceof Error?error.message:"Remote delivery pending"
    },200);
  }
}

async function interaction(path:string,body:any,auth:string|null){const u=await user(auth);if(!u)return json({error:"Authentication required"},401);const target=String(body.target||body.post_id||body.postId||body.object_url||body.objectUrl||"").trim();if(/^https:\/\//i.test(target)||target.includes("@")){const r=await transport({user_id:u.id,operation:path,target});const data=r.data();return json(data,r.status)}return null}
async function followOp(enabled:boolean,body:any,auth:string|null){const u=await user(auth);if(!u)return json({error:"Authentication required"},401);const target=String(body.target||"").trim();if(!target)return json({error:"target required"},400);const remote=await interaction(enabled?"follow":"unfollow",{target},auth);if(remote)return remote;const p=await localTarget(target);if(!p)return json({error:"User not found"},404);if(p.id===u.id)return json({error:"Cannot follow yourself"},400);const r=await admin.rpc("set_follow_state",{p_following_id:p.id,p_follow:enabled});if(r.error)return json({error:r.error.message},400);return json(r.data||{ok:true,following:enabled});}
async function react(kind:string,enabled:boolean,body:any,auth:string|null){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(body.post_id||body.postId||body.object_url||"").trim();
  if(!target)return json({error:"post_id required"},400);
  if(/^https:\/\//i.test(target)){
    const interactionType = kind === "favorite" ? "like" : "repost";
    // Record the user's intent before network delivery. This mirrors Mastodon's
    // local state model: the button changes immediately while federation is
    // transport/remote-server work.
    const pending = await admin.from("federated_interactions").upsert({
      user_id:u.id, object_uri:target, interaction_type:interactionType,
      active:enabled, delivery_state:"pending", updated_at:new Date().toISOString()
    }, {onConflict:"user_id,object_uri,interaction_type"});
    if(pending.error)return json({ok:false,error:"Failed to persist federated interaction",details:pending.error.message},500);

    const activity=enabled
      ? (kind==="favorite"
        ? {type:"Like",object:target}
        : {type:"Announce",object:target})
      : {type:"Undo",object:target,object_type:kind==="favorite"?"Like":"Announce"};
    try {
      const r=await transport({user_id:u.id,operation:"deliver",target,activity});
      const data=r.data();
      const delivered=data?.ok===true && (data?.delivery?.status==="delivered" || data?.delivery?.status==="queued" || data?.delivery?.queue?.status==="delivered" || data?.delivery?.queue?.status==="queued");
      await admin.from("federated_interactions").update({
        active:enabled, delivery_state:delivered ? "delivered" : "failed",
        activity_uri:data?.activity?.id ?? null, remote_actor_uri:data?.remote?.actorUrl ?? null,
        updated_at:new Date().toISOString()
      }).eq("user_id",u.id).eq("object_uri",target).eq("interaction_type",interactionType);
      return json({...data, ok:true, accepted:delivered, status:delivered?"delivered":"failed"},200);
    } catch (error) {
      await admin.from("federated_interactions").update({
        active:enabled, delivery_state:"pending", updated_at:new Date().toISOString()
      }).eq("user_id",u.id).eq("object_uri",target).eq("interaction_type",interactionType);
      console.warn(`federated ${kind} delivery pending`, error);
      return json({ok:true,accepted:false,status:"pending",queued:true,error:error instanceof Error?error.message:`Remote server rejected ${kind}`},200);
    }
  }
  const post=await localPost(target);if(!post)return json({error:"Post not found"},404);
  if(kind==="favorite"){
    const existing=await admin.from("post_reactions").select("id").eq("post_id",target).eq("user_id",u.id).eq("emoji","❤️").maybeSingle();
    if(existing.error)return json({error:existing.error.message},400);
    if(existing.data){
      const d=await admin.from("post_reactions").delete().eq("post_id",target).eq("user_id",u.id);
      if(d.error)return json({error:d.error.message},400);
    } else {
      const d=await admin.from("post_reactions").delete().eq("post_id",target).eq("user_id",u.id);
      if(d.error)return json({error:d.error.message},400);
      const i=await admin.from("post_reactions").insert({post_id:target,user_id:u.id,emoji:"❤️"});
      if(i.error)return json({error:i.error.message},400);
    }
    const count=await admin.from("post_reactions").select("id",{count:"exact",head:true}).eq("post_id",target).eq("emoji","❤️");
    const likes=Number(count.count||0);
    const p=await admin.from("posts").update({likes_count:likes,updated_at:new Date().toISOString()}).eq("id",target);
    if(p.error)return json({error:p.error.message},400);
    return json({ok:true,state:{is_liked:Boolean(!existing.data),likes_count:likes}},200);
  }
  const existing=await admin.from("reposts").select("id").eq("post_id",target).eq("user_id",u.id).maybeSingle();
  if(existing.error)return json({error:existing.error.message},400);
  if(existing.data){
    const d=await admin.from("reposts").delete().eq("id",existing.data.id); if(d.error)return json({error:d.error.message},400);
  } else {
    const i=await admin.from("reposts").insert({post_id:target,user_id:u.id}); if(i.error)return json({error:i.error.message},400);
  }
  const count=await admin.from("reposts").select("id",{count:"exact",head:true}).eq("post_id",target);
  const reposts=Number(count.count||0);
  const p=await admin.from("posts").update({reposts_count:reposts,updated_at:new Date().toISOString()}).eq("id",target);
  if(p.error)return json({error:p.error.message},400);
  return json({ok:true,state:{is_reposted:Boolean(!existing.data),reposts_count:reposts}},200);
}
async function search(q:string,type:string,auth:string|null){const term=q.trim();if(!term)return json([]);if(type==="hashtags"){const r=await admin.from("hashtags").select("*").ilike("tag",`%${term.replace(/^#/,'')}%`).limit(50);return json(r.data||[])}if(type==="posts"){const r=await admin.from("posts").select("*,author:profiles!posts_author_id_fkey(*)").is("deleted_at",null).eq("visibility","public").ilike("content",`%${term}%`).order("created_at",{ascending:false}).limit(50);return json(r.data||[])}if(type==="instances"){const r=await admin.from("federated_instances").select("*").ilike("domain",`%${term}%`).limit(50);return json(r.data||[])}const r=await admin.from("profiles").select("*").or(`username.ilike.%${term}%,display_name.ilike.%${term}%`).limit(50);if(auth){const u=await user(auth);if(u)await admin.from("search_queries").insert({user_id:u.id,query:q,filters:{type}})}return json(r.data||[])}
async function collection(username:string,kind:string){const p=await localProfile(username);if(!p)return json({error:"User not found"},404);if(kind==="followers"){const r=await admin.from("follows").select("follower_id,profiles!follows_follower_id_fkey(*)").eq("following_id",p.id).eq("status","accepted").limit(100);return json(r.data||[])}const r=await admin.from("follows").select("following_id,profiles!follows_following_id_fkey(*)").eq("follower_id",p.id).eq("status","accepted").limit(100);return json(r.data||[])}
Deno.serve(async req=>{if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});try{const auth=req.headers.get("Authorization");const url=new URL(req.url);let e:any={};if(!["GET","HEAD"].includes(req.method)){const t=await req.text();if(t)try{e=JSON.parse(t)}catch{e={}}}const rawPath=String(e.path||url.pathname.replace(/^\/functions\/v1\/testagram-api/,"").replace(/^\/testagram-api/,"")||"/health").trim();const path=rawPath.startsWith("/")?rawPath:`/${rawPath}`;const method=String(e.method||req.method).toUpperCase();const body=e.body||{};const params={...Object.fromEntries(url.searchParams.entries()),...(e.params||{})};if(path==="/"||path==="/health")return json({ok:true,service:"testagram-api",backend:"supabase",onspaceDependency:false,federation:true,apiVersion:"4"});if(path==="/timeline/home")return fn(FEED,"POST",{mode:"home",limit:params.limit||20,before:params.before||undefined},auth);if(path==="/timeline/global")return fn(FEED,"POST",{mode:"explore",limit:params.limit||20,before:params.before||undefined},auth);if(path==="/timeline/local")return json((await admin.from("posts").select("*,author:profiles!posts_author_id_fkey(*)").is("deleted_at",null).eq("visibility","public").order("created_at",{ascending:false}).limit(Math.min(100,Number(params.limit||50)))).data||[]);if(path==="/timeline/federated")return fn(`${SUPABASE_URL}/functions/v1/federation-appview`,`GET`,{},auth,params);if(path==="/posts"&&method==="POST")return fn(POST_CREATE,"POST",body,auth);if(path.match(/^\/posts\/[^/]+$/)&&method==="DELETE"){const u=await user(auth);if(!u)return json({error:"Authentication required"},401);const id=decodeURIComponent(path.split("/").pop()!);const r=await admin.from("posts").update({deleted_at:new Date().toISOString()}).eq("id",id).eq("author_id",u.id);if(r.error)return json({error:r.error.message},400);return json({ok:true});}if(path==="/follow"&&method==="POST")return followOp(true,body,auth);if(path==="/unfollow"&&method==="POST")return followOp(false,body,auth);if(path==="/favorite"&&method==="POST")return react("favorite",true,body,auth);if(path==="/unfavorite"&&method==="POST")return react("favorite",false,body,auth);if(path==="/boost"&&method==="POST")return react("boost",true,body,auth);if(path==="/unboost"&&method==="POST")return react("boost",false,body,auth);if(path==="/bookmark"&&method==="POST"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(body.post_id||body.postId||"").trim();
  if(!/^https:\/\//i.test(target))return json({error:"Bookmark target must be a remote ActivityPub object"},400);
  const r=await admin.from("federated_bookmarks").upsert({user_id:u.id,object_uri:target},{onConflict:"user_id,object_uri"}).select("id,object_uri,created_at").single();
  if(r.error)return json({error:r.error.message},400);
  return json({ok:true,bookmark:r.data});
}
if(path==="/unbookmark"&&method==="POST"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(body.post_id||body.postId||"").trim();
  if(!/^https:\/\//i.test(target))return json({error:"Bookmark target must be a remote ActivityPub object"},400);
  const r=await admin.from("federated_bookmarks").delete().eq("user_id",u.id).eq("object_uri",target);
  if(r.error)return json({error:r.error.message},400);
  return json({ok:true,removed:true});
}
if((path==="/federated/reactions"||path==="/federated-reaction")&&method==="POST"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(body.post_id||body.postId||body.object_uri||body.objectUri||"").trim();
  const emoji=String(body.emoji||"").trim();
  const enabled=body.enabled!==false;
  if(!/^https:\/\//i.test(target)||!emoji)return json({error:"Remote reaction requires object URI and emoji"},400);
  const object=await admin.from("federated_objects").select("id").eq("uri",target).maybeSingle();
  if(object.error)return json({error:object.error.message},400);
  if(!object.data?.id)return json({error:"Remote object is not cached yet"},404);
  if(enabled){
    const r=await admin.from("federated_reactions").upsert({
      user_id:u.id,object_id:object.data.id,object_uri:target,reaction_type:"reaction",content:emoji,delivered:false,updated_at:new Date().toISOString()
    },{onConflict:"user_id,object_uri,reaction_type,content"}).select("id,user_id,object_id,object_uri,reaction_type,content,delivered,delivery_error,created_at,updated_at").single();
    if(r.error)return json({error:"Failed to persist federated emoji reaction",details:r.error.message},500);
    try{
      const transportResult=await transport({user_id:u.id,operation:"deliver",target,activity:{type:"EmojiReact",object:target,content:emoji}});
      const data=transportResult.data();
      const delivered=data?.delivery?.status==="delivered"||data?.delivery?.status==="queued"||data?.accepted===true;
      await admin.from("federated_reactions").update({delivered,delivery_error:delivered?null:String(data?.error||"")||null,updated_at:new Date().toISOString()}).eq("id",r.data.id);
      return json({ok:true,active:true,delivered,reaction:r.data},200);
    }catch(error){
      await admin.from("federated_reactions").update({delivered:false,delivery_error:error instanceof Error?error.message:"Remote reaction delivery pending",updated_at:new Date().toISOString()}).eq("id",r.data.id);
      return json({ok:true,active:true,delivered:false,pending:true,reaction:r.data},200);
    }
  }
  const r=await admin.from("federated_reactions").delete().eq("user_id",u.id).eq("object_uri",target).eq("reaction_type","reaction").eq("content",emoji);
  if(r.error)return json({error:"Failed to remove federated emoji reaction",details:r.error.message},500);
  return json({ok:true,active:false,emoji},200);
}
if((path==="/federated/reactions"||path==="/federated-reaction-state")&&method==="GET"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(params.object_uri||params.objectUri||"").trim();
  if(!/^https:\/\//i.test(target))return json({error:"object_uri must be a remote ActivityPub object"},400);
  const r=await admin.from("federated_reactions").select("content,delivered,delivery_error,updated_at").eq("user_id",u.id).eq("object_uri",target).eq("reaction_type","reaction");
  if(r.error)return json({error:r.error.message},400);
  const emojis=(r.data||[]).map((x:any)=>String(x.content||"")).filter(Boolean);
  return json({emojis,emoji:emojis[0]||null,active:emojis.length>0,reactions:r.data||[]},200);
}
if(path==="/federated-reaction-counts"&&method==="GET"){
  const target=String(params.object_uri||params.objectUri||"").trim();
  if(!/^https:\/\//i.test(target))return json({error:"object_uri must be a remote ActivityPub object"},400);
  const r=await admin.from("federated_reactions").select("content").eq("object_uri",target).eq("reaction_type","reaction");
  if(r.error)return json({error:r.error.message},400);
  const counts:any={}; for(const row of r.data||[]){const k=String(row.content||""); if(k)counts[k]=(counts[k]||0)+1;}
  return json({counts},200);
}
if(path==="/federated-actor"&&method==="GET"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(params.actor_uri||params.actorUri||"").trim();
  if(!/^https?:\/\//i.test(target))return json({error:"actor_uri must be an ActivityPub actor URL"},400);
  try{
    const r=await transport({user_id:u.id,operation:"resolve",target});
    const data=r.data();
    return json(data,r.status);
  }catch(error){
    return json({ok:false,error:error instanceof Error?error.message:"Remote actor unavailable"},502);
  }
}
if(path==="/federated-object"&&method==="GET"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(params.object_uri||params.objectUri||"").trim();
  if(!/^https:\/\//i.test(target))return json({error:"object_uri must be a remote ActivityPub object"},400);
  try{
    const r=await transport({user_id:u.id,operation:"fetch",target});
    const data=r.data();
    return json(data,r.status);
  }catch(error){
    return json({ok:false,error:error instanceof Error?error.message:"Remote object unavailable"},502);
  }
}
if(path==="/federated-interaction-state"&&method==="GET"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(params.object_uri||params.objectUri||"").trim();
  if(!/^https:\/\//i.test(target))return json({error:"object_uri must be a remote ActivityPub object"},400);
  const r=await admin.from("federated_interactions").select("interaction_type,active,activity_uri,remote_actor_uri,delivery_state,updated_at").eq("user_id",u.id).eq("object_uri",target);
  if(r.error)return json({error:r.error.message},400);
  const state:any={like:false,repost:false};
  for(const row of r.data||[]){ if(row.interaction_type==="like")state.like=Boolean(row.active); if(row.interaction_type==="repost")state.repost=Boolean(row.active); }
  return json(state);
}
if(path==="/interaction-counts"&&method==="GET"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(params.post_id||params.postId||params.object_uri||params.objectUri||"").trim();
  if(!target)return json({error:"post_id required"},400);

  if(/^https:\/\//i.test(target)){
    const [object,ledger,reactions,replies,quotes,views,bookmarks,replyShares] = await Promise.all([
      admin.from("federated_objects").select("like_count,announce_count,reply_count,quote_count,view_count").eq("uri",target).maybeSingle(),
      admin.from("federated_interactions").select("interaction_type,active,user_id").eq("object_uri",target),
      admin.from("federated_reactions").select("content,user_id").eq("object_uri",target).eq("reaction_type","reaction"),
      admin.from("federated_replies").select("id",{count:"exact",head:true}).eq("object_uri",target),
      admin.from("federated_quotes").select("id",{count:"exact",head:true}).eq("object_uri",target),
      admin.from("federated_post_views").select("id",{count:"exact",head:true}).eq("object_uri",target),
      admin.from("federated_bookmarks").select("id,user_id",{count:"exact"}).eq("object_uri",target),
      admin.from("federated_reply_shares").select("id",{count:"exact",head:true}).eq("object_uri",target)
    ]);
    const remote = object.data ?? {};
    let remoteLikes=Number(remote.like_count||0), remoteReposts=Number(remote.announce_count||0);
    if (!object.data) {
      try {
        const rr=await transport({user_id:u?.id||null,operation:"inspect",target});
        const d=rr.data();
        remoteLikes=Math.max(remoteLikes,Number(d?.counts?.likes||0));
        remoteReposts=Math.max(remoteReposts,Number(d?.counts?.reposts||0));
      } catch {}
    }
    let likes=remoteLikes, reposts=remoteReposts, viewerLiked=false, viewerReposted=false;
    for(const row of ledger.data||[]){
      if(row.active&&row.interaction_type==="like"){likes++;if(u && String(row.user_id)===String(u.id))viewerLiked=true;}
      if(row.active&&row.interaction_type==="repost"){reposts++;if(u && String(row.user_id)===String(u.id))viewerReposted=true;}
    }
    const reactionCounts:any={}; const userReactions:string[]=[];
    for(const row of reactions.data||[]){const k=String(row.content||"");if(k)reactionCounts[k]=(reactionCounts[k]||0)+1;if(u && String(row.user_id)===String(u.id)&&k)userReactions.push(k);}
    return json({
      likes:Math.max(likes,Number(remote.like_count||0)),
      reposts:Math.max(reposts,Number(remote.announce_count||0)),
      replies:Math.max(Number(replies.count||0),Number(remote.reply_count||0)),
      quotes:Math.max(Number(quotes.count||0),Number(remote.quote_count||0)),
      views:Math.max(Number(views.count||0),Number(remote.view_count||0)),
      shares:Number(replyShares.count||0),
      bookmarks:Number(bookmarks.count||0),
      reactions:reactionCounts,
      reaction_total:Object.values(reactionCounts).reduce((sum:number,n:any)=>sum+Number(n||0),0),
      is_liked:viewerLiked,
      is_reposted:viewerReposted,
      is_bookmarked:Boolean(u && (bookmarks.data||[]).some((row:any)=>String(row.user_id)===String(u.id))),
      user_reactions:userReactions
    },200);
  }

  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target))return json({error:"post_id must be a local UUID or remote ActivityPub URI"},400);
  const [post,reactions,reposts,replies,quotes,bookmarks,analytics] = await Promise.all([
    admin.from("posts").select("views_count,likes_count,reposts_count,replies_count,quoted_post_id").eq("id",target).maybeSingle(),
    admin.from("post_reactions").select("emoji,user_id").eq("post_id",target),
    admin.from("reposts").select("id,quote").eq("post_id",target),
    admin.from("replies").select("id",{count:"exact",head:true}).eq("post_id",target),
    admin.from("posts").select("id",{count:"exact",head:true}).eq("quoted_post_id",target),
    admin.from("bookmarks").select("id",{count:"exact",head:true}).eq("post_id",target),
    admin.from("post_analytics").select("shares").eq("post_id",target).maybeSingle()
  ]);
  const reactionCounts:any={}; const userReactions:string[]=[];
  for(const row of reactions.data||[]){const k=String(row.emoji||"");if(k)reactionCounts[k]=(reactionCounts[k]||0)+1;if(u && String(row.user_id)===String(u.id)&&k)userReactions.push(k);}
  const heartCount=Number(reactionCounts["❤️"]||0);
  const repostCount=Number(reposts.data?.length||0);
  const quoteFromReposts=(reposts.data||[]).filter((r:any)=>Boolean(r.quote)).length;
  const quoteCount=Math.max(Number(quotes.count||0),quoteFromReposts);
  const viewerLikeRow=await admin.from("post_reactions").select("id").eq("post_id",target).eq("user_id",u.id).eq("emoji","❤️").maybeSingle();
  const viewerRepostRow=await admin.from("reposts").select("id").eq("post_id",target).eq("user_id",u.id).maybeSingle();
  const viewerBookmarkRow=await admin.from("bookmarks").select("id").eq("post_id",target).eq("user_id",u.id).maybeSingle();
  return json({
    likes:Math.max(heartCount,Number(post.data?.likes_count||0)),
    reposts:Math.max(repostCount,Number(post.data?.reposts_count||0)),
    replies:Math.max(Number(replies.count||0),Number(post.data?.replies_count||0)),
    quotes:quoteCount,
    views:Math.max(Number(post.data?.views_count||0),0),
    shares:Number(analytics.data?.shares||0),
    bookmarks:Number(bookmarks.count||0),
    reactions:reactionCounts,
    reaction_total:Object.values(reactionCounts).reduce((sum:number,n:any)=>sum+Number(n||0),0),
    is_liked:Boolean(viewerLikeRow.data),
    is_reposted:Boolean(viewerRepostRow.data),
    is_bookmarked:Boolean(viewerBookmarkRow.data),
    user_reactions:userReactions
  },200);
}
if(path==="/federated-interaction-counts"&&method==="GET"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(params.object_uri||params.objectUri||"").trim();
  if(!/^https:\/\//i.test(target))return json({error:"object_uri must be a remote ActivityPub object"},400);
  const [ledger,replies,quotes,views]=await Promise.all([
    admin.from("federated_interactions").select("interaction_type,active").eq("object_uri",target),
    admin.from("federated_replies").select("id",{count:"exact",head:true}).eq("object_uri",target),
    admin.from("federated_quotes").select("id",{count:"exact",head:true}).eq("object_uri",target),
    admin.from("federated_post_views").select("id",{count:"exact",head:true}).eq("object_uri",target)
  ]);
  let likes=0,reposts=0;
  for(const row of ledger.data||[]){if(row.active&&row.interaction_type==="like")likes++;if(row.active&&row.interaction_type==="repost")reposts++;}
  try{const rr=await transport({user_id:u.id,operation:"inspect",target});const d=rr.data();likes=Math.max(likes,Number(d?.counts?.likes||0));reposts=Math.max(reposts,Number(d?.counts?.reposts||0));}catch{}
  return json({likes,reposts,replies:Number(replies.count||0),quotes:Number(quotes.count||0),views:Number(views.count||0)},200);
}
if(path==="/record-post-share"&&method==="POST"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(body.post_id||body.postId||"").trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target))return json({error:"post_id must be a local UUID"},400);
  const r=await admin.rpc("testagram_record_post_share",{p_post_id:target});
  if(r.error)return json({error:r.error.message},400);
  return json({ok:true,shares:Number(r.data||0)},200);
}
if(path==="/record-post-view"&&method==="POST"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(body.post_id||body.postId||"").trim();
  if(!target)return json({error:"post_id required"},400);
  try{
    if(/^https:\/\//i.test(target)){
      const r=await admin.rpc("testagram_record_federated_post_view",{p_object_uri:target});
      if(r.error)return json({error:r.error.message},400);
      return json({ok:true,views:Number(r.data||0)},200);
    }
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target))return json({error:"invalid post_id"},400);
    const r=await admin.rpc("testagram_record_post_view",{p_post_id:target});
    if(r.error)return json({error:r.error.message},400);
    return json({ok:true,views:Number(r.data||0)},200);
  }catch(error){return json({error:error instanceof Error?error.message:"view recording failed"},500);}
}
if(path==="/bookmark-state"&&method==="GET"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(params.post_id||"").trim();
  if(!/^https:\/\//i.test(target))return json({error:"Bookmark target must be a remote ActivityPub object"},400);
  const r=await admin.from("federated_bookmarks").select("id").eq("user_id",u.id).eq("object_uri",target).maybeSingle();
  if(r.error)return json({error:r.error.message},400);
  return json({bookmarked:Boolean(r.data)});
}
if(path==="/federated-reply-share"&&method==="POST"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(body.object_uri||body.objectUri||body.reply_id||body.replyId||"").trim();
  if(!/^https:\/\//i.test(target))return json({error:"Remote reply share requires an ActivityPub object URI"},400);
  const r=await admin.from("federated_reply_shares").upsert({user_id:u.id,object_uri:target},{onConflict:"user_id,object_uri"}).select("id,object_uri,created_at").single();
  if(r.error)return json({error:"Failed to persist reply share",details:r.error.message},500);
  const count=await admin.from("federated_reply_shares").select("id",{count:"exact",head:true}).eq("object_uri",target);
  return json({ok:true,active:true,shares:Number(count.count||0),share:r.data},200);
}
if(path==="/federated-reply-share"&&method==="DELETE"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(params.object_uri||params.objectUri||"").trim();
  if(!/^https:\/\//i.test(target))return json({error:"Remote reply share requires an ActivityPub object URI"},400);
  const r=await admin.from("federated_reply_shares").delete().eq("user_id",u.id).eq("object_uri",target);
  if(r.error)return json({error:r.message},400);
  const count=await admin.from("federated_reply_shares").select("id",{count:"exact",head:true}).eq("object_uri",target);
  return json({ok:true,active:false,shares:Number(count.count||0)},200);
}
if(path==="/federated-replies"&&method==="GET"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(params.object_uri||params.objectUri||"").trim();
  if(!/^https:\/\//i.test(target))return json({error:"object_uri must be a remote ActivityPub object"},400);
  const parentUri=String(params.parent_uri||params.parentUri||"").trim();
  const replyUri=String(params.reply_object_uri||params.replyObjectUri||"").trim();
  const activityUri=String(params.activity_uri||params.activityUri||"").trim();
  let query=admin.from("federated_replies").select("id,user_id,object_uri,parent_uri,reply_object_uri,content,activity_uri,delivery_state,created_at,updated_at").order("created_at",{ascending:false}).limit(100);
  if(parentUri) query=query.eq("parent_uri",parentUri);
  else if(replyUri) query=query.eq("reply_object_uri",replyUri);
  else if(activityUri) query=query.eq("activity_uri",activityUri);
  else query=query.eq("object_uri",target);
  const result=await query;
  if(result.error)return json({error:result.error.message},400);
  const rows=result.data||[];
  const userIds=[...new Set(rows.map((row:any)=>row.user_id).filter(Boolean))];
  let profiles:any[]=[];
  if(userIds.length){
    const p=await admin.from("profiles").select("id,username,display_name,full_name,avatar_url,verified").in("id",userIds);
    if(p.error)return json({error:p.error.message},400);
    profiles=p.data||[];
  }
  const profileById=new Map(profiles.map((profile:any)=>[String(profile.id),profile]));
  return json({items:rows.map((row:any)=>({...row,profile:profileById.get(String(row.user_id))||null}))},200);
}
if(path==="/reply"&&method==="POST")return replyOp(body,auth);
if(path==="/quote"&&method==="POST"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(body.post_id||body.postId||"").trim(), content=String(body.content||"").trim();
  if(!target||!content)return json({error:"post_id and content required"},400);
  if(!/^https:\/\//i.test(target))return json({error:"Quote target must be a remote ActivityPub object"},400);
  const local=await admin.from("federated_quotes").insert({user_id:u.id,object_uri:target,content,delivery_state:"pending"}).select("id,object_uri,content,delivery_state,created_at").single();
  if(local.error)return json({error:"Failed to persist federated quote",details:local.error.message},500);
  const activity:any={type:"Create",object:{type:"Note",content,quote:target}};
  try{
    const r=await transport({user_id:u.id,operation:"deliver",target,activity});
    const data=r.data(); const delivered=data?.delivery?.status==="delivered"||data?.delivery?.status==="queued"||data?.accepted===true;
    await admin.from("federated_quotes").update({activity_uri:data?.activity?.id??data?.activity?.object?.id??null,delivery_state:delivered?"delivered":"pending",delivery_error:delivered?null:String(data?.error||"")||null,updated_at:new Date().toISOString()}).eq("id",local.data.id);
    return json({...data,ok:true,accepted:delivered,quote_id:local.data.id},200);
  }catch(error){
    await admin.from("federated_quotes").update({delivery_state:"pending",delivery_error:error instanceof Error?error.message:"Remote quote delivery pending",updated_at:new Date().toISOString()}).eq("id",local.data.id);
    return json({ok:true,accepted:false,status:"pending",queued:true,quote_id:local.data.id,error:error instanceof Error?error.message:"Remote quote delivery pending"},200);
  }
}
if(path==="/flag"&&method==="POST"){
  const u=await user(auth); if(!u)return json({error:"Authentication required"},401);
  const target=String(body.post_id||body.postId||"").trim(), category=String(body.category||"other").trim();
  if(!target)return json({error:"post_id required"},400);
  if(!/^https:\/\//i.test(target))return json({error:"Flag target must be a remote ActivityPub object"},400);
  const r=await transport({user_id:u.id,operation:"deliver",target,activity:{type:"Flag",object:target,content:category}});
  const data=r.data(); return json(data,r.status);
}if(path==="/notifications"&&method==="GET"){const u=await user(auth);if(!u)return json({error:"Authentication required"},401);const r=await admin.from("notifications").select("*").eq("recipient_id",u.id).order("created_at",{ascending:false}).limit(100);return json(r.data||[])}if(path==="/notifications"&&method==="DELETE"){const u=await user(auth);if(!u)return json({error:"Authentication required"},401);const r=await admin.from("notifications").delete().eq("recipient_id",u.id);return r.error?json({error:r.error.message},500):json({ok:true})}if(path==="/search")return search(String(params.q||""),String(params.type||"users"),auth);const m=path.match(/^\/users\/([^/]+)\/(followers|following)$/);if(m)return collection(decodeURIComponent(m[1]),m[2]);const a=path.match(/^\/users\/([^/]+)$/);if(a){const actor=await localActor(decodeURIComponent(a[1]));return actor?json(actor):json({error:"actor not found"},404)}if(path.startsWith("/webfinger/")){const actor=await localActor(decodeURIComponent(path.slice("/webfinger/".length)));if(!actor)return json({error:"actor not found"},404);return json({subject:`acct:${actor.preferredUsername}@testagram.site`,aliases:[actor.id],links:[{rel:"self",type:"application/activity+json",href:actor.id}]})}return json({error:"not found"},404);}catch(error){console.error("testagram-api v4",error);return json({error:error instanceof Error?error.message:"Testagram API failure"},500)}});