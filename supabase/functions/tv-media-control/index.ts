import "jsr:@supabase/supabase-js@2";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url=Deno.env.get("SUPABASE_URL")??"";
const key=Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??Deno.env.get("SUPABASE_ANON_KEY")??"";
const secret=Deno.env.get("SUPABASE_SECRET_KEY")??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ytKey=Deno.env.get("YOUTUBE_STREAM_KEY")??"";
const ytClientId=Deno.env.get("YOUTUBE_CLIENT_ID")??"";
const ytClientSecret=Deno.env.get("YOUTUBE_CLIENT_SECRET")??"";
const ytRefresh=Deno.env.get("YOUTUBE_REFRESH_TOKEN")??"";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"Content-Type":"application/json",...cors}});
const db=(a:string)=>createClient(url,key,{global:{headers:a?{Authorization:a}:{}},auth:{persistSession:false,autoRefreshToken:false}});
const admin=()=>createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,"0")).join("");
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,"0")).join("");
const ytApiReady=()=>Boolean(ytKey&&ytClientId&&ytClientSecret&&ytRefresh);
class YouTubeStageError extends Error{phase:string;httpStatus:number|null;reason:string|null;constructor(phase:string,message:string,httpStatus:number|null=null,reason:string|null=null){super(message);this.phase=phase;this.httpStatus=httpStatus;this.reason=reason;}}
async function ytToken(){
 if(!ytApiReady())throw new YouTubeStageError("authorization","YouTube Live credentials are not configured.",null,"credentials_missing");
 const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:ytClientId,client_secret:ytClientSecret,refresh_token:ytRefresh,grant_type:"refresh_token"})});
 const p=await r.json().catch(()=>null);
 if(!r.ok||!p?.access_token)throw new YouTubeStageError("authorization","YouTube OAuth refresh failed: "+(p?.error_description||p?.error||"unknown error"),r.status,String(p?.error||"oauth_refresh_failed"));
 return String(p.access_token);
}
async function ytApi(path:string,init:RequestInit={},phase="api"){
 const token=await ytToken();
 const r=await fetch("https://www.googleapis.com/youtube/v3/"+path,{...init,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...(init.headers||{})}});
 const p=await r.json().catch(()=>null);
 if(!r.ok){
  const first=p?.error?.errors?.[0]||{};
  const reason=String(first?.reason||p?.error?.message||"request_failed");
  const message=String(p?.error?.message||reason);
  const detail=[reason,first?.domain?String(first.domain):"",first?.location?String(first.location):""].filter(Boolean).join(" · ");
  throw new YouTubeStageError(phase,"YouTube API "+r.status+": "+message+(detail&&detail!==reason?" ["+detail+"]":""),r.status,reason);
 }
 return p;
}
const ytRetryable=(e:any)=>e instanceof YouTubeStageError&&[500,502,503,504].includes(Number(e.httpStatus))&&["backendError","internalError","serviceUnavailable"].includes(String(e.reason));
const ytDeleteBroadcast=async(id:string)=>{
 try{await ytApi("liveBroadcasts?id="+encodeURIComponent(id),{method:"DELETE"},"broadcast_cleanup");}catch{}
};
async function ytPrepare(s:any){
 const streams=await ytApi("liveStreams?part=id,snippet,cdn,status&mine=true&maxResults=50",{},"stream_lookup");
 const stream=(streams?.items||[]).find((x:any)=>String(x?.cdn?.ingestionInfo?.streamName||"")===ytKey);
 if(!stream?.id)throw new YouTubeStageError("stream_lookup","Configured YOUTUBE_STREAM_KEY does not match a stream owned by the authorized YouTube channel.",200,"stream_not_found");
 const streamId=String(stream.id);
 const active=await ytApi("liveBroadcasts?part=id,status,contentDetails&broadcastStatus=active&broadcastType=event&maxResults=50",{},"active_broadcast_lookup");
 const activeMatch=(active?.items||[]).find((x:any)=>String(x?.contentDetails?.boundStreamId||"")===streamId&&["live","liveStarting"].includes(String(x?.status?.lifeCycleStatus||"")));
 if(activeMatch?.id)throw new YouTubeStageError("broadcast_lookup",`A YouTube broadcast is already active on the configured stream (broadcast ${String(activeMatch.id)}; status ${String(activeMatch?.status?.lifeCycleStatus||"unknown")}).`,409,"broadcast_already_active");
 const upcoming=await ytApi("liveBroadcasts?part=id,snippet,status,contentDetails&broadcastStatus=upcoming&broadcastType=event&maxResults=50",{},"broadcast_lookup");
 let broadcast=(upcoming?.items||[]).find((x:any)=>String(x?.contentDetails?.boundStreamId||"")===streamId&&["created","ready"].includes(String(x?.status?.lifeCycleStatus||"")));
 let createdByTestagram=false;
 if(!broadcast){
  const now=new Date(Date.now()+120000).toISOString();
  broadcast=await ytApi("liveBroadcasts?part=snippet,status,contentDetails",{method:"POST",body:JSON.stringify({snippet:{title:String(s.title||"Testagram TV Live").slice(0,100),description:String(s.description||"Live from Testagram TV Studio").slice(0,5000),scheduledStartTime:now},status:{privacyStatus:"unlisted"},contentDetails:{enableAutoStart:true,enableAutoStop:true,enableEmbed:true,enableDvr:true,recordFromStart:true,monitorStream:{enableMonitorStream:false},latencyPreference:"low"}})},"broadcast_create");
  createdByTestagram=true;
 }
 if(!broadcast?.id)throw new YouTubeStageError("broadcast_create","YouTube did not return a broadcast id.",200,"broadcast_id_missing");
 const lifecycle=String(broadcast?.status?.lifeCycleStatus||"");
 if(lifecycle==="ready"&&String(broadcast?.contentDetails?.boundStreamId||"")===streamId){
  return {broadcastId:String(broadcast.id),streamId,videoId:String(broadcast.id),createdByTestagram};
 }
 let lastBindError:any=null;
 for(let attempt=0;attempt<5;attempt++){
  try{
   await ytApi("liveBroadcasts/bind?part=id,snippet,contentDetails&id="+encodeURIComponent(broadcast.id)+"&streamId="+encodeURIComponent(streamId),{method:"POST"},"bind");
   return {broadcastId:String(broadcast.id),streamId,videoId:String(broadcast.id),createdByTestagram};
  }catch(e:any){
   lastBindError=e;
   if(!ytRetryable(e)||attempt===4){
    if(createdByTestagram)await ytDeleteBroadcast(String(broadcast.id));
    throw e;
   }
   await new Promise(r=>setTimeout(r,[1500,3000,6000,10000,15000][attempt]));
  }
 }
 if(createdByTestagram)await ytDeleteBroadcast(String(broadcast.id));
 throw lastBindError||new YouTubeStageError("bind","YouTube broadcast binding failed.",500,"backendError");
}
async function ytState(broadcastId:string,streamId:string){
 const [s,b]=await Promise.all([ytApi("liveStreams?part=id,cdn,status&id="+encodeURIComponent(streamId),{},"stream_state"),ytApi("liveBroadcasts?part=id,status,contentDetails&id="+encodeURIComponent(broadcastId),{},"broadcast_state")]);
 const stream=s?.items?.[0]||null,bc=b?.items?.[0]||null;
 return {stream,broadcast:bc,streamStatus:String(stream?.status?.streamStatus||"unknown"),broadcastStatus:String(bc?.status?.lifeCycleStatus||"unknown"),onAir:String(stream?.status?.streamStatus)==="active"&&["live","liveStarting"].includes(String(bc?.status?.lifeCycleStatus))};
}
const ytTransitionLive=(id:string)=>ytApi("liveBroadcasts/transition?part=id,status&id="+encodeURIComponent(id)+"&broadcastStatus=live",{method:"POST",body:"{}"},"broadcast_transition");
const ytTransitionComplete=(id:string)=>ytApi("liveBroadcasts/transition?part=id,status&id="+encodeURIComponent(id)+"&broadcastStatus=complete",{method:"POST",body:"{}"},"broadcast_complete");
const embed=(id:string)=>"https://www.youtube.com/embed/"+encodeURIComponent(id)+"?autoplay=1&playsinline=1";
async function ice(){return[{urls:["stun:stun.cloudflare.com:3478","stun:stun.l.google.com:19302"]}];}
async function youtubeEncoderConfig(id:string,t:string){
 const a=admin();
 const {data:s,error}=await a.from("live_streams").select("id,user_id,is_live,tv_provider,youtube_stream_id,youtube_video_id,youtube_broadcast_id").eq("id",id).maybeSingle();
 if(error||!s||!s.is_live||s.tv_provider!=="youtube"||!s.youtube_stream_id)throw new Error("YouTube encoder session is not active.");
 const {data:session,error:se}=await a.from("tv_youtube_encoder_sessions").select("id,stream_id,user_id,expires_at,revoked_at").eq("stream_id",id).eq("token_hash",await hash(t)).maybeSingle();
 if(se||!session||session.revoked_at||new Date(session.expires_at).getTime()<=Date.now())throw new Error("YouTube encoder session is invalid or expired.");
 const y=await ytApi("liveStreams?part=id,cdn,status&id="+encodeURIComponent(s.youtube_stream_id),{},"encoder_config");
 const stream=y?.items?.[0];
 const address=String(stream?.cdn?.ingestionInfo?.rtmpsIngestionAddress||stream?.cdn?.ingestionInfo?.ingestionAddress||"");
 const name=String(stream?.cdn?.ingestionInfo?.streamName||ytKey||"");
 if(!address||!name)throw new Error("YouTube did not return usable RTMPS ingestion credentials.");
 await a.from("tv_youtube_encoder_sessions").update({claimed_at:new Date().toISOString()}).eq("id",session.id);
 return {rtmps_ingestion_address:address,stream_name:name,video_id:s.youtube_video_id||s.youtube_broadcast_id||null};
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return json({ok:true});
 if(req.method!=="POST")return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"POST required."}},405);
 if(!url||!key)return json({ok:false,error:{code:"SUPABASE_NOT_CONFIGURED",message:"Supabase TV control is not configured."}},503);
 let b:any;try{b=await req.json()}catch{return json({ok:false,error:{code:"INVALID_JSON",message:"JSON required."}},400)}
 const id=typeof b.stream_id==="string"?b.stream_id:"";
 const action=typeof b.action==="string"?b.action:"viewer";
 const invite=typeof b.invite_token==="string"?b.invite_token:"";
 if(!id)return json({ok:false,error:{code:"STREAM_ID_REQUIRED",message:"stream_id is required."}},400);
 const auth=req.headers.get("authorization")||"",adminClient=admin(),client=action==="viewer"?adminClient:db(auth);
 if(action==="youtube-encoder-config"){
  const token=typeof b.encoder_token==="string"?b.encoder_token:"";
  if(!token)return json({ok:false,error:{code:"ENCODER_TOKEN_REQUIRED",message:"YouTube encoder session token is required."}},401);
  try{return json({ok:true,data:await youtubeEncoderConfig(id,token),error:null});}
  catch(e:any){return json({ok:false,error:{code:"YOUTUBE_ENCODER_CONFIG_FAILED",message:e?.message||"YouTube encoder configuration is unavailable."}},502)}
 }
 const {data:s,error}=await client.from("live_streams").select("id,user_id,is_live,title,description,viewer_count,tv_provider,tv_connection_state,tv_last_heartbeat_at,tv_host_peer_id,youtube_broadcast_id,youtube_stream_id,youtube_video_id,youtube_status,youtube_error").eq("id",id).maybeSingle();
 if(error||!s)return json({ok:false,error:{code:"STREAM_NOT_FOUND",message:"TV broadcast was not found."}},404);
 const user=auth.startsWith("Bearer ")?(await client.auth.getUser()).data.user:null,owner=Boolean(user&&user.id===s.user_id);
 const platformOwner=Boolean(user&&(await client.rpc("testagram_is_owner")).data===true);
 const contract=async(role:string,extra:any={})=>({provider:"youtube",room_id:id,room_type:"tv",role,signaling_topic:"tv:"+id,title:s.title,viewer_count:s.viewer_count??0,ice_servers:role==="viewer"?[]:await ice(),playback_id:s.youtube_video_id||s.youtube_broadcast_id||null,playback_url:s.youtube_video_id||s.youtube_broadcast_id?embed(s.youtube_video_id||s.youtube_broadcast_id):null,testagram:{status:s.tv_connection_state||"offline"},youtube:{enabled:ytApiReady(),status:s.youtube_status||"disabled",broadcast_id:s.youtube_broadcast_id||null,stream_id:s.youtube_stream_id||null,video_id:s.youtube_video_id||s.youtube_broadcast_id||null,error:s.youtube_error||null},...extra});
 if(action==="start"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can start this TV broadcast."}},403);
  if(s.is_live)return json({ok:false,error:{code:"STREAM_ALREADY_LIVE",message:"This TV broadcast is already live."}},409);
  if(!ytApiReady())return json({ok:false,error:{code:"YOUTUBE_NOT_CONFIGURED",message:"YouTube Live credentials are not configured on the TV control plane."}},503);
  const {data:claim,error:claimError}=await adminClient.from("live_streams").update({tv_connection_state:"starting",youtube_status:"preparing",youtube_error:null,tv_last_heartbeat_at:new Date().toISOString()}).eq("id",id).eq("user_id",s.user_id).eq("is_live",false).eq("tv_connection_state","offline").select("id").maybeSingle();
  if(claimError)return json({ok:false,error:{code:"TV_START_CLAIM_FAILED",message:"Could not reserve this TV broadcast for startup."}},409);
  if(!claim)return json({ok:false,error:{code:"TV_START_IN_PROGRESS",message:"This TV broadcast is already being started by another studio session."}},409);
  let y:any;try{y=await ytPrepare(s)}catch(e:any){const ye=e instanceof YouTubeStageError?e:new YouTubeStageError("prepare",e?.message||"YouTube preparation failed.");await adminClient.from("live_streams").update({youtube_status:"error",youtube_error:JSON.stringify({message:ye.message,phase:ye.phase,http_status:ye.httpStatus,reason:ye.reason}),tv_connection_state:"offline",tv_last_heartbeat_at:null}).eq("id",id).eq("user_id",s.user_id);return json({ok:false,error:{code:"YOUTUBE_SETUP_FAILED",message:ye.message,phase:ye.phase,http_status:ye.httpStatus,reason:ye.reason}},502)}
  const enc=randomToken();
  const {error:se}=await adminClient.from("tv_youtube_encoder_sessions").insert({stream_id:id,user_id:s.user_id,token_hash:await hash(enc),expires_at:new Date(Date.now()+12*60*60*1000).toISOString()});
  if(se){if(y?.createdByTestagram)await ytDeleteBroadcast(y.broadcastId);await adminClient.from("live_streams").update({tv_connection_state:"offline",youtube_status:"error",youtube_error:"Could not create the secure YouTube encoder session.",tv_last_heartbeat_at:null}).eq("id",id).eq("user_id",s.user_id);return json({ok:false,error:{code:"YOUTUBE_ENCODER_SESSION_FAILED",message:"Could not create the secure YouTube encoder session."}},500);}
  const {error:ue}=await adminClient.from("live_streams").update({is_live:true,started_at:new Date().toISOString(),ended_at:null,stream_url:embed(y.videoId),tv_provider:"youtube",tv_connection_state:"starting",tv_last_heartbeat_at:new Date().toISOString(),tv_host_peer_id:null,viewer_count:0,youtube_broadcast_id:y.broadcastId,youtube_stream_id:y.streamId,youtube_video_id:y.videoId,youtube_status:"prepared",youtube_error:null}).eq("id",id).eq("user_id",s.user_id);
  if(ue){await adminClient.from("tv_youtube_encoder_sessions").update({revoked_at:new Date().toISOString()}).eq("stream_id",id).eq("token_hash",await hash(enc));try{await ytTransitionComplete(y.broadcastId)}catch{};if(y?.createdByTestagram)await ytDeleteBroadcast(y.broadcastId);return json({ok:false,error:{code:"TV_START_FAILED",message:"Could not start the YouTube TV broadcast."}},409)}
  return json({ok:true,data:await contract("host",{on_air:false,output_mode:"youtube",youtube:{enabled:true,status:"prepared",broadcast_id:y.broadcastId,stream_id:y.streamId,video_id:y.videoId,encoder_token:enc}}),error:null});
 }
 if(action==="verify"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can verify this TV broadcast."}},403);
  if(!s.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"TV broadcast is not live."}},409);
  if(!s.youtube_broadcast_id||!s.youtube_stream_id)return json({ok:false,error:{code:"YOUTUBE_SESSION_MISSING",message:"YouTube broadcast and stream are not configured."}},409);
  try{
   let y=await ytState(s.youtube_broadcast_id,s.youtube_stream_id);
   if(y.streamStatus==="active"&&y.broadcastStatus!=="live"){try{await ytTransitionLive(s.youtube_broadcast_id)}catch{};y=await ytState(s.youtube_broadcast_id,s.youtube_stream_id);}
   const onAir=y.onAir,status=onAir?"broadcasting":y.streamStatus==="active"?"receiving":y.broadcastStatus;
   await adminClient.from("live_streams").update({tv_connection_state:onAir?"connected":"starting",tv_last_heartbeat_at:new Date().toISOString(),youtube_status:status,youtube_error:null,stream_url:embed(s.youtube_video_id||s.youtube_broadcast_id)}).eq("id",id).eq("user_id",s.user_id);
   return json({ok:true,data:await contract("host",{on_air:onAir,output_mode:"youtube",youtube_stream_status:y.streamStatus,youtube_broadcast_status:y.broadcastStatus,health:{provider:"youtube",stream_status:y.streamStatus,broadcast_status:y.broadcastStatus}}),error:null});
  }catch(e:any){const ye=e instanceof YouTubeStageError?e:new YouTubeStageError("verify",e?.message||"YouTube state verification failed.");return json({ok:false,error:{code:"YOUTUBE_VERIFY_FAILED",message:ye.message,phase:ye.phase,http_status:ye.httpStatus,reason:ye.reason}},502)}
 }
 if(action==="stop"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can stop this TV broadcast."}},403);
  if(s.youtube_broadcast_id&&ytApiReady())try{await ytTransitionComplete(s.youtube_broadcast_id)}catch{}
  await adminClient.from("tv_youtube_encoder_sessions").update({revoked_at:new Date().toISOString()}).eq("stream_id",id).is("revoked_at",null);
  const {error:e}=await adminClient.from("live_streams").update({is_live:false,ended_at:new Date().toISOString(),tv_connection_state:"offline",tv_last_heartbeat_at:null,tv_host_peer_id:null,viewer_count:0,youtube_status:"stopped",youtube_error:null}).eq("id",id).eq("user_id",s.user_id);
  if(e)return json({ok:false,error:{code:"TV_STOP_FAILED",message:"Could not stop this TV broadcast."}},409);
  return json({ok:true,data:await contract("host"),error:null});
 }
 if(action==="heartbeat"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can send a TV heartbeat."}},403);
  if(!s.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"Broadcast is not live."}},409);
  const state=["starting","connected","degraded","stale"].includes(b.connection_state)?b.connection_state:"degraded",count=Math.max(0,Math.min(100000,Number(b.viewer_count)||0)),peer=typeof b.peer_id==="string"&&b.peer_id.length<=128?b.peer_id:"";
  const {error:e}=await adminClient.from("live_streams").update({tv_last_heartbeat_at:new Date().toISOString(),tv_connection_state:state,tv_host_peer_id:peer||null,viewer_count:count}).eq("id",id).eq("user_id",s.user_id).eq("is_live",true);
  if(e)return json({ok:false,error:{code:"TV_HEARTBEAT_FAILED",message:"Could not update TV broadcast health."}},409);
  return json({ok:true,data:{heartbeat_ok:true,connection_state:state,viewer_count:count},error:null});
 }
 if(action==="create-guest"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can create a guest invite."}},403);
  const now=new Date().toISOString();
  const {data:activeInvites,error:listError}=await adminClient.from("tv_guest_invites").select("slot_number").eq("stream_id",id).gt("expires_at",now);
  if(listError)return json({ok:false,error:{code:"GUEST_CAPACITY_LOOKUP_FAILED",message:"Could not check guest slot capacity."}},409);
  const usedSlots=new Set((activeInvites||[]).map((row:any)=>Number(row.slot_number)).filter((slot:number)=>Number.isInteger(slot)&&slot>=1&&slot<=6));
  const slot=Array.from({length:6},(_,index)=>index+1).find(candidate=>!usedSlots.has(candidate));
  if(!slot)return json({ok:false,error:{code:"GUEST_CAPACITY_REACHED",message:"All six Testagram TV guest multiview slots are occupied."}},409);
  const t=randomToken(),expiresAt=new Date(Date.now()+3600000).toISOString();
  const {error:e}=await adminClient.from("tv_guest_invites").insert({stream_id:id,slot_number:slot,token_hash:await hash(t),expires_at:expiresAt});
  if(e)return json({ok:false,error:{code:"GUEST_INVITE_FAILED",message:"Could not create the guest invite."}},409);
  return json({ok:true,data:{invite_token:t,room_id:id,guest_slot:slot,guest_label:"Guest "+slot,expires_at:expiresAt,signaling_topic:"tv:"+id,ice_servers:await ice()},error:null});
 }
 if(action==="guest"){
  if(!invite)return json({ok:false,error:{code:"INVITE_REQUIRED",message:"A TV guest invite is required."}},401);
  if(!user)return json({ok:false,error:{code:"AUTH_REQUIRED",message:"Authentication is required to join the TV guest session."}},401);
  if(!secret)return json({ok:false,error:{code:"TV_CONTROL_MISCONFIGURED",message:"TV guest claiming requires the Supabase server secret."}},503);
  const now=new Date().toISOString();
  const {data:inviteRow,error:ie}=await adminClient.from("tv_guest_invites").select("id,slot_number,blocked,muted").eq("stream_id",id).eq("token_hash",await hash(invite)).is("used_at",null).gt("expires_at",now).maybeSingle();
  if(ie||!inviteRow)return json({ok:false,error:{code:"INVITE_INVALID",message:"This TV guest invite is invalid, expired, or already claimed."}},401);
  if(Boolean(inviteRow.blocked))return json({ok:false,error:{code:"GUEST_BLOCKED",message:"This guest slot has been blocked by the studio."}},403);
  const {data:claimed,error:e}=await adminClient.from("tv_guest_invites").update({used_at:now,claimed_by:user.id,claimed_at:now}).eq("id",inviteRow.id).is("used_at",null).select("id,slot_number,blocked,muted").maybeSingle();
  if(e||!claimed)return json({ok:false,error:{code:"INVITE_INVALID",message:"This TV guest invite is invalid, expired, or already claimed."}},401);
  return json({ok:true,data:{...(await contract("guest")),guest_token:invite,guest_slot:Number(claimed.slot_number||0),guest_label:"Guest "+Number(claimed.slot_number||0),muted:Boolean(claimed.muted),blocked:Boolean(claimed.blocked)},error:null});
 }
 if(action==="viewer"&&platformOwner&&!s.is_live)return json({ok:true,data:await contract("host",{preview:true,on_air:false}),error:null});
 if(!s.is_live)return json({ok:false,error:{code:"STREAM_ENDED",message:"Broadcast is no longer live."}},409);
 return json({ok:true,data:await contract(action==="viewer"?"viewer":"unknown"),error:null});
});