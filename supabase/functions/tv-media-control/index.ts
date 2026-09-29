import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const secret = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ytClientId = Deno.env.get("YOUTUBE_CLIENT_ID") ?? "";
const ytClientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET") ?? "";
const ytRefreshToken = Deno.env.get("YOUTUBE_REFRESH_TOKEN") ?? "";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store","Vary":"Origin, Access-Control-Request-Headers"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json",...cors}});
const client=(auth:string)=>createClient(url,key,{global:{headers:auth?{Authorization:auth}:{}},auth:{persistSession:false,autoRefreshToken:false}});
const admin=()=>createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,"0")).join("");
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,"0")).join("");

async function youtubeAccessToken(){
  if(!ytClientId||!ytClientSecret||!ytRefreshToken) throw new Error("YouTube server credentials are not configured.");
  const body=new URLSearchParams({client_id:ytClientId,client_secret:ytClientSecret,refresh_token:ytRefreshToken,grant_type:"refresh_token"});
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
  const p=await r.json().catch(()=>null);
  if(!r.ok||!p?.access_token) throw new Error("YouTube OAuth refresh failed.");
  return p.access_token as string;
}
async function youtubeRequest(path:string,token:string,init:RequestInit={}){
  const r=await fetch("https://www.googleapis.com/youtube/v3/"+path,{...init,headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json",...(init.headers||{})}});
  const p=await r.json().catch(()=>null);
  if(!r.ok) throw new Error(p?.error?.message||`YouTube API request failed (${r.status}).`);
  return p;
}
async function prepareYouTubeBroadcast(stream:any){
  const token=await youtubeAccessToken();
  const now=new Date(Date.now()+60_000).toISOString();
  const title=(stream.title||"Testagram TV Live").slice(0,100);
  const description=(stream.description||"Live from Testagram TV Studio").slice(0,500);
  const createdStream=await youtubeRequest("liveStreams?part=snippet,cdn,status",{method:"POST",body:JSON.stringify({
    snippet:{title:`${title} · Testagram TV`,description},
    cdn:{frameRate:"variable",resolution:"variable",ingestionType:"rtmp"},
  })},token);
  const broadcast=await youtubeRequest("liveBroadcasts?part=snippet,status,contentDetails",{method:"POST",body:JSON.stringify({
    snippet:{title,description,scheduledStartTime:now},
    status:{privacyStatus:"public",selfDeclaredMadeForKids:false},
    contentDetails:{enableAutoStart:true,enableAutoStop:true,recordFromStart:true,enableDvr:true},
  })},token);
  await youtubeRequest(`liveBroadcasts/bind?part=id&id=${encodeURIComponent(broadcast.id)}&streamId=${encodeURIComponent(createdStream.id)}`,token,{method:"POST"});
  return {
    broadcast_id:createdStream?.id?broadcast.id:null,
    stream_id:createdStream?.id||null,
    video_id:broadcast?.id||null,
    status:broadcast?.status?.lifeCycleStatus||"created",
    ingest_configured:true,
    encoder_required:true,
    rtmps_ingestion_address:createdStream?.cdn?.ingestionInfo?.rtmpsIngestionAddress||null,
    stream_name:createdStream?.cdn?.ingestionInfo?.streamName||null,
  };
}

Deno.serve(async req=>{
 if(req.method==="OPTIONS") return json({ok:true});
 if(req.method!=="POST") return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"POST required."}},405);
 if(!url||!key) return json({ok:false,error:{code:"SUPABASE_NOT_CONFIGURED",message:"Supabase TV control is not configured."}},503);
 let body:any; try{body=await req.json()}catch{return json({ok:false,error:{code:"INVALID_JSON",message:"JSON required."}},400);}
 const streamId=typeof body.stream_id==="string"?body.stream_id:"";
 const action=typeof body.action==="string"?body.action:"viewer";
 const inviteToken=typeof body.invite_token==="string"?body.invite_token:"";
 if(!streamId) return json({ok:false,error:{code:"STREAM_ID_REQUIRED",message:"stream_id is required."}},400);
 const auth=req.headers.get("authorization")||"";
 const db=client(auth);
 const {data:stream,error}=await db.from("live_streams").select("id,user_id,is_live,title,description,viewer_count,tv_provider,youtube_broadcast_id,youtube_stream_id,youtube_video_id").eq("id",streamId).maybeSingle();
 if(error||!stream) return json({ok:false,error:{code:"STREAM_NOT_FOUND",message:"TV broadcast was not found."}},404);
 const user=auth.startsWith("Bearer ")?(await db.auth.getUser()).data.user:null;
 const owner=Boolean(user&&user.id===stream.user_id);
 const provider=body.provider==="youtube"?"youtube":(stream.tv_provider||"native-p2p");
 const contract=(role:string)=>({provider,room_id:streamId,room_type:"tv",role,signaling_topic:"tv:"+streamId,title:stream.title,viewer_count:stream.viewer_count??0,ice_servers:[],youtube_video_id:stream.youtube_video_id||null,youtube_broadcast_id:stream.youtube_broadcast_id||null});

 if(action==="start"){
   if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can start this TV broadcast."}},403);
   const now=new Date().toISOString();
   let youtube:any=null;
   if(provider==="youtube"){
     try{ youtube=await prepareYouTubeBroadcast(stream); }
     catch(e:any){ return json({ok:false,error:{code:"YOUTUBE_SETUP_FAILED",message:e?.message||"Could not prepare YouTube Live."}},502); }
   }
   const {data:updated,error:e}=await db.from("live_streams").update({
     is_live:true,started_at:now,ended_at:null,
     stream_url:youtube?.video_id?`https://www.youtube.com/watch?v=${youtube.video_id}`:null,
     tv_provider:provider,tv_connection_state:"starting",tv_last_heartbeat_at:now,tv_host_peer_id:null,viewer_count:0,
     youtube_broadcast_id:youtube?.broadcast_id||null,youtube_stream_id:youtube?.stream_id||null,youtube_video_id:youtube?.video_id||null
   }).eq("id",streamId).eq("user_id",stream.user_id).select("id,user_id,is_live,title,description,viewer_count,tv_provider,youtube_broadcast_id,youtube_stream_id,youtube_video_id").single();
   if(e||!updated)return json({ok:false,error:{code:"TV_START_FAILED",message:"Could not start the TV broadcast."}},409);
   return json({ok:true,data:{...contract("host"),youtube:youtube?{video_id:youtube.video_id,broadcast_id:youtube.broadcast_id,stream_id:youtube.stream_id,status:youtube.status,encoder_required:true,rtmps_ingestion_address:youtube.rtmps_ingestion_address,stream_name:youtube.stream_name}:null},error:null});
 }
 if(action==="stop"){
   if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can stop this TV broadcast."}},403);
   if(stream.tv_provider==="youtube"&&stream.youtube_broadcast_id){
     try{const token=await youtubeAccessToken(); await youtubeRequest(`liveBroadcasts?part=status&id=${encodeURIComponent(stream.youtube_broadcast_id)}`,token,{method:"GET"}); const b=await youtubeRequest(`liveBroadcasts?part=status&id=${encodeURIComponent(stream.youtube_broadcast_id)}`,token); if(["live","testing"].includes(b?.items?.[0]?.status?.lifeCycleStatus)){await youtubeRequest(`liveBroadcasts/transition?part=id,status&id=${encodeURIComponent(stream.youtube_broadcast_id)}&broadcastStatus=complete`,token,{method:"POST"});}}catch{ /* Testagram state must still be stopped if YouTube is unavailable. */ }
   }
   const {error:e}=await db.from("live_streams").update({is_live:false,ended_at:new Date().toISOString(),stream_url:null,tv_connection_state:"offline",tv_last_heartbeat_at:null,tv_host_peer_id:null,viewer_count:0,youtube_broadcast_id:null,youtube_stream_id:null,youtube_video_id:null}).eq("id",streamId).eq("user_id",stream.user_id);
   if(e)return json({ok:false,error:{code:"TV_STOP_FAILED",message:"Could not stop the TV broadcast."}},409);
   return json({ok:true,data:contract("host"),error:null});
 }
 if(action==="verify"){
   if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can verify this TV broadcast."}},403);
   if(!stream.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"TV broadcast is not live."}},409);
   if(provider==="youtube"&&stream.youtube_broadcast_id){
     try{const token=await youtubeAccessToken();const b=await youtubeRequest(`liveBroadcasts?part=status,contentDetails&id=${encodeURIComponent(stream.youtube_broadcast_id)}`,token);const item=b?.items?.[0];const ytState=item?.status?.lifeCycleStatus||"unknown";const onAir=ytState==="live";if(onAir){await db.from("live_streams").update({tv_connection_state:"connected",tv_last_heartbeat_at:new Date().toISOString()}).eq("id",streamId).eq("user_id",stream.user_id);}return json({ok:true,data:{...contract("host"),on_air:onAir,health:{provider:"youtube",youtube_lifecycle:ytState,viewer_count:stream.viewer_count??0},youtube:{video_id:stream.youtube_video_id,broadcast_id:stream.youtube_broadcast_id}},error:null});}catch(e:any){return json({ok:false,error:{code:"YOUTUBE_VERIFY_FAILED",message:e?.message||"Could not verify YouTube Live."}},502);}
   }
   const {data:fresh}=await db.from("live_streams").select("is_live,tv_connection_state,tv_last_heartbeat_at,viewer_count").eq("id",streamId).maybeSingle();
   const heartbeatAge=fresh?.tv_last_heartbeat_at ? Date.now()-new Date(fresh.tv_last_heartbeat_at).getTime() : Infinity;
   const healthy=heartbeatAge<=30000 && ["starting","connected","degraded"].includes(fresh?.tv_connection_state||"");
   return json({ok:true,data:{...contract("host"),on_air:healthy,health:{connection_state:fresh?.tv_connection_state||"offline",heartbeat_age_ms:Number.isFinite(heartbeatAge)?heartbeatAge:null,viewer_count:fresh?.viewer_count??0}},error:null});
 }
 if(action==="heartbeat"){
   if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can send a TV heartbeat."}},403);
   if(!stream.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"Broadcast is not live."}},409);
   if(provider==="youtube") return json({ok:true,data:{heartbeat_ok:true,connection_state:stream.tv_connection_state||"starting",viewer_count:stream.viewer_count??0},error:null});
   const state=["starting","connected","degraded","stale"].includes(body.connection_state)?body.connection_state:"degraded";
   const viewerCount=Math.max(0,Math.min(100000,Number(body.viewer_count)||0));
   const peerId=typeof body.peer_id==="string"&&body.peer_id.length<=128?body.peer_id:"";
   const {error:e}=await db.from("live_streams").update({tv_last_heartbeat_at:new Date().toISOString(),tv_connection_state:state,tv_host_peer_id:peerId||null,viewer_count:viewerCount}).eq("id",streamId).eq("user_id",stream.user_id).eq("is_live",true);
   if(e)return json({ok:false,error:{code:"TV_HEARTBEAT_FAILED",message:"Could not update TV broadcast health."}},409);
   return json({ok:true,data:{heartbeat_ok:true,connection_state:state,viewer_count:viewerCount},error:null});
 }
 if(action==="create-guest"){
   if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can create a guest invite."}},403);
   if(!stream.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"Start the TV broadcast before inviting a guest."}},409);
   if(provider==="youtube") return json({ok:false,error:{code:"GUEST_UNSUPPORTED_FOR_YOUTUBE",message:"YouTube mass-distribution mode does not support Testagram WebRTC guest contribution. Use native studio mode for guest participation."}},409);
   const token=randomToken();
   const {error:e}=await db.from("tv_guest_invites").insert({stream_id:streamId,token_hash:await hash(token),expires_at:new Date(Date.now()+3600000).toISOString()});
   if(e)return json({ok:false,error:{code:"GUEST_INVITE_FAILED",message:"Could not create the guest invite."}},409);
   return json({ok:true,data:{invite_token:token,room_id:streamId,signaling_topic:"tv:"+streamId},error:null});
 }
 if(action==="guest"){
   if(provider==="youtube")return json({ok:false,error:{code:"GUEST_UNSUPPORTED_FOR_YOUTUBE",message:"YouTube mass-distribution mode is viewer-only."}},409);
   if(!stream.is_live)return json({ok:false,error:{code:"STREAM_ENDED",message:"Broadcast is no longer live."}},409);
   if(!inviteToken)return json({ok:false,error:{code:"INVITE_REQUIRED",message:"A TV guest invite is required."}},401);
   if(!user)return json({ok:false,error:{code:"AUTH_REQUIRED",message:"Authentication is required to join the TV guest session."}},401);
   if(!secret)return json({ok:false,error:{code:"TV_CONTROL_MISCONFIGURED",message:"TV guest claiming requires the Supabase server secret."}},503);
   const inviteDb=admin(); const now=new Date().toISOString();
   const {data:claimed,error:claimError}=await inviteDb.from("tv_guest_invites").update({used_at:now,claimed_by:user.id,claimed_at:now}).eq("stream_id",streamId).eq("token_hash",await hash(inviteToken)).is("used_at",null).gt("expires_at",now).select("id").maybeSingle();
   if(claimError||!claimed)return json({ok:false,error:{code:"INVITE_INVALID",message:"This TV guest invite is invalid, expired, or already claimed."}},401);
   return json({ok:true,data:{...contract("guest"),guest_token:inviteToken},error:null});
 }
 if(!stream.is_live)return json({ok:false,error:{code:"STREAM_ENDED",message:"Broadcast is no longer live."}},409);
 if(provider==="youtube") return json({ok:true,data:{...contract("viewer"),playback_url:stream.youtube_video_id?`https://www.youtube.com/embed/${stream.youtube_video_id}?autoplay=1&playsinline=1`:null},error:null});
 return json({ok:true,data:contract("viewer"),error:null});
});
