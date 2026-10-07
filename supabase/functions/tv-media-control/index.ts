import "jsr:@supabase/supabase-js@2";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { upsertFirebaseLiveMetadata } from "../_shared/firebase-firestore.ts";

const url=Deno.env.get("SUPABASE_URL")??"";
const key=Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??Deno.env.get("SUPABASE_ANON_KEY")??"";
const secret=Deno.env.get("SUPABASE_SECRET_KEY")??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const bunnyLibraryId=Deno.env.get("BUNNY_STREAM_LIBRARY_ID")??"";
const bunnyApiKey=Deno.env.get("BUNNY_STREAM_API_KEY")??"";
const bunnyApiBase="https://video.bunnycdn.com";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"Content-Type":"application/json",...cors}});
const db=(a:string)=>createClient(url,key,{global:{headers:a?{Authorization:a}:{}},auth:{persistSession:false,autoRefreshToken:false}});
const admin=()=>createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,"0")).join("");
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,"0")).join("");
const bunnyReady=()=>Boolean(bunnyLibraryId&&bunnyApiKey);
class BunnyStageError extends Error{phase:string;httpStatus:number|null;constructor(phase:string,message:string,httpStatus:number|null=null){super(message);this.phase=phase;this.httpStatus=httpStatus;}}
async function bunnyApi(path:string,init:RequestInit={},phase="api"){
 if(!bunnyReady())throw new BunnyStageError("authorization","Bunny Stream credentials are not configured.",null);
 const r=await fetch(bunnyApiBase+path,{...init,headers:{"AccessKey":bunnyApiKey,"Content-Type":"application/json",...(init.headers||{})}});
 const p=await r.json().catch(()=>null);
 if(!r.ok)throw new BunnyStageError(phase,String(p?.message||p?.error||`Bunny Stream API ${r.status}`),r.status);
 return p;
}
async function bunnyPrepare(s:any){
 const p=await bunnyApi(`/library/${encodeURIComponent(bunnyLibraryId)}/live`,{method:"POST",body:JSON.stringify({title:String(s.title||"Testagram TV Live").slice(0,100),description:String(s.description||"Live from Testagram TV Studio").slice(0,5000),recordVod:false,dvrEnabled:false,public:true})},"stream_create");
 const streamId=String(p?.guid||""),streamKey=String(p?.streamKey||""),ingest=String(p?.ingestEndpoints?.rtmp?.primaryIngestUrl||""),backupIngest=String(p?.ingestEndpoints?.rtmp?.backupIngestUrl||""),playback=String(p?.playbackUrlHls||"");
 if(!streamId||!streamKey||!ingest||!playback)throw new BunnyStageError("stream_create","Bunny did not return complete live-stream credentials.",200);
 return {streamId,streamKey,ingest,backupIngest,playback};
}
async function bunnyStatus(streamId:string){
 const p=await bunnyApi(`/library/${encodeURIComponent(bunnyLibraryId)}/live/${encodeURIComponent(streamId)}/status`,{},"stream_status");
 return {readyToStart:Boolean(p?.readyToStart),primaryLive:Boolean(p?.primaryLive),backupLive:Boolean(p?.backupLive),lastPingAgo:Number(p?.lastPingAgo||0),duration:Number(p?.duration||0)};
}
const bunnyStart=(streamId:string)=>bunnyApi(`/library/${encodeURIComponent(bunnyLibraryId)}/live/${encodeURIComponent(streamId)}/start`,{method:"PUT"},"stream_start");
const bunnyStop=(streamId:string)=>bunnyApi(`/library/${encodeURIComponent(bunnyLibraryId)}/live/${encodeURIComponent(streamId)}/stop`,{method:"PUT"},"stream_stop");
const bunnyPlayback=(url:string)=>url;
async function ice(){return[{urls:["stun:stun.cloudflare.com:3478","stun:stun.l.google.com:19302"]}];}
async function bunnyEncoderConfig(id:string,t:string){
 const a=admin();
 const {data:s,error}=await a.from("live_streams").select("id,user_id,is_live,tv_provider,bunny_live_stream_id,bunny_ingest_url").eq("id",id).maybeSingle();
 if(error||!s||!s.is_live||s.tv_provider!=="bunny"||!s.bunny_live_stream_id)throw new Error("Bunny encoder session is not active.");
 const {data:session,error:se}=await a.from("tv_bunny_encoder_sessions").select("id,stream_id,user_id,expires_at,revoked_at").eq("stream_id",id).eq("token_hash",await hash(t)).maybeSingle();
 if(se||!session||session.revoked_at||new Date(session.expires_at).getTime()<=Date.now())throw new Error("Bunny encoder session is invalid or expired.");
 const streamKey=Deno.env.get("BUNNY_STREAM_KEY_"+s.bunny_live_stream_id)||"";
 if(!streamKey)throw new Error("Bunny stream key is unavailable for this live session.");
 await a.from("tv_bunny_encoder_sessions").update({claimed_at:new Date().toISOString()}).eq("id",session.id);
 return {rtmp_ingestion_address:String(s.bunny_ingest_url),stream_name:streamKey};
}
Deno.serveDeno.serve(async req=>{
 if(req.method==="OPTIONS")return json({ok:true});
 if(req.method!=="POST")return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"POST required."}},405);
 if(!url||!key)return json({ok:false,error:{code:"SUPABASE_NOT_CONFIGURED",message:"Supabase TV control is not configured."}},503);
 let b:any;try{b=await req.json()}catch{return json({ok:false,error:{code:"INVALID_JSON",message:"JSON required."}},400)}
 const id=typeof b.stream_id==="string"?b.stream_id:"";
 const action=typeof b.action==="string"?b.action:"viewer";
 const invite=typeof b.invite_token==="string"?b.invite_token:"";
 if(!id)return json({ok:false,error:{code:"STREAM_ID_REQUIRED",message:"stream_id is required."}},400);
 const auth=req.headers.get("authorization")||"",adminClient=admin(),client=action==="viewer"?adminClient:db(auth);
 if(action==="bunny-encoder-config"){
  const token=typeof b.encoder_token==="string"?b.encoder_token:"";
  if(!token)return json({ok:false,error:{code:"ENCODER_TOKEN_REQUIRED",message:"Bunny encoder session token is required."}},401);
  try{return json({ok:true,data:await youtubeEncoderConfig(id,token),error:null});}
  catch(e:any){return json({ok:false,error:{code:"BUNNY_ENCODER_CONFIG_FAILED",message:e?.message||"Bunny encoder configuration is unavailable."}},502)}
 }
 const {data:s,error}=await client.from("live_streams").select("id,user_id,is_live,title,description,viewer_count,tv_provider,tv_connection_state,tv_last_heartbeat_at,tv_host_peer_id,bunny_live_stream_id,bunny_playback_url,bunny_ingest_url").eq("id",id).maybeSingle();
 if(error||!s)return json({ok:false,error:{code:"STREAM_NOT_FOUND",message:"TV broadcast was not found."}},404);
 const user=auth.startsWith("Bearer ")?(await client.auth.getUser()).data.user:null,owner=Boolean(user&&user.id===s.user_id);
 const platformOwner=Boolean(user&&(await client.rpc("testagram_is_owner")).data===true);
 const contract=async(role:string,extra:any={})=>({provider:"bunny",output_mode:"bunny-live",native_p2p:{enabled:true,max_viewers:20,transport:"webrtc",signaling:"supabase-realtime"},room_id:id,room_type:"tv",role,signaling_topic:"tv:"+id,title:s.title,viewer_count:s.viewer_count??0,ice_servers:role==="viewer"?[]:await ice(),playback_id:s.bunny_live_stream_id||null,playback_url:s.bunny_playback_url?bunnyPlayback(s.bunny_playback_url):null,testagram:{status:s.tv_connection_state||"offline"},bunny:{enabled:bunnyReady(),status:s.tv_connection_state||"offline",live_stream_id:s.bunny_live_stream_id||null,playback_url:s.bunny_playback_url||null,error:null},...extra});
 if(action==="start"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can start this TV broadcast."}},403);
  if(s.is_live)return json({ok:false,error:{code:"STREAM_ALREADY_LIVE",message:"This TV broadcast is already live."}},409);
  if(!bunnyReady())return json({ok:false,error:{code:"BUNNY_NOT_CONFIGURED",message:"Bunny Stream credentials are not configured on the TV control plane."}},503);
  const {data:claim,error:claimError}=await adminClient.from("live_streams").update({tv_connection_state:"starting",tv_last_heartbeat_at:new Date().toISOString()}).eq("id",id).eq("user_id",s.user_id).eq("is_live",false).eq("tv_connection_state","offline").select("id").maybeSingle();
  if(claimError)return json({ok:false,error:{code:"TV_START_CLAIM_FAILED",message:"Could not reserve this TV broadcast for startup."}},409);
  if(!claim)return json({ok:false,error:{code:"TV_START_IN_PROGRESS",message:"This TV broadcast is already being started by another studio session."}},409);
  let y:any;try{y=await bunnyPrepare(s)}catch(e:any){const be=e instanceof BunnyStageError?e:new BunnyStageError("prepare",e?.message||"Bunny preparation failed.");await adminClient.from("live_streams").update({tv_connection_state:"offline",tv_last_heartbeat_at:null}).eq("id",id).eq("user_id",s.user_id);return json({ok:false,error:{code:"BUNNY_SETUP_FAILED",message:be.message,phase:be.phase,http_status:be.httpStatus}},502)}
  const enc=randomToken(),now=new Date().toISOString();
  const {error:se}=await adminClient.from("tv_bunny_encoder_sessions").insert({stream_id:id,user_id:s.user_id,token_hash:await hash(enc),bunny_live_stream_id:y.streamId,expires_at:new Date(Date.now()+12*60*60*1000).toISOString()});
  if(se){try{await bunnyStop(y.streamId)}catch{};return json({ok:false,error:{code:"BUNNY_ENCODER_SESSION_FAILED",message:"Could not create the secure Bunny encoder session."}},500);}
  const {error:ue}=await adminClient.from("live_streams").update({is_live:true,started_at:now,ended_at:null,stream_url:y.playback,tv_provider:"bunny",tv_connection_state:"starting",tv_last_heartbeat_at:now,tv_host_peer_id:null,viewer_count:0,bunny_live_stream_id:y.streamId,bunny_playback_url:y.playback,bunny_ingest_url:y.ingest}).eq("id",id).eq("user_id",s.user_id);
  if(ue){await adminClient.from("tv_bunny_encoder_sessions").update({revoked_at:now}).eq("stream_id",id).eq("token_hash",await hash(enc));try{await bunnyStop(y.streamId)}catch{};return json({ok:false,error:{code:"TV_START_FAILED",message:"Could not start the Bunny TV broadcast."}},409)}
  try{await upsertFirebaseLiveMetadata(id,{owner_id:s.user_id,title:s.title,description:s.description||"",category:s.category||"general",status:"starting",is_live:true,started_at:now,ended_at:null,viewer_count:0,provider:"bunny",bunny_live_stream_id:y.streamId,playback_url:y.playback,record_vod:false,dvr_enabled:false,video_persistence:"ephemeral"});}catch(e:any){await adminClient.from("live_streams").update({is_live:false,tv_connection_state:"offline",tv_last_heartbeat_at:null,bunny_live_stream_id:null,bunny_playback_url:null,bunny_ingest_url:null,stream_url:null}).eq("id",id).eq("user_id",s.user_id);await adminClient.from("tv_bunny_encoder_sessions").update({revoked_at:now}).eq("stream_id",id).eq("token_hash",await hash(enc));try{await bunnyStop(y.streamId)}catch{};return json({ok:false,error:{code:"FIREBASE_METADATA_FAILED",message:e?.message||"Firebase metadata store is unavailable."}},503)}
  return json({ok:true,data:await contract("host",{on_air:false,output_mode:"bunny-live",bunny:{enabled:true,status:"prepared",live_stream_id:y.streamId,playback_url:y.playback,encoder_token:enc,rtmp_ingestion_address:y.ingest}}),error:null});
 }
 if(action==="verify"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can verify this TV broadcast."}},403);
  if(!s.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"TV broadcast is not live."}},409);
  if(!s.bunny_live_stream_id)return json({ok:false,error:{code:"BUNNY_SESSION_MISSING",message:"Bunny live stream is not configured."}},409);
  try{
   let y=await bunnyStatus(s.bunny_live_stream_id);
   if(y.readyToStart&&y.primaryLive){try{await bunnyStart(s.bunny_live_stream_id)}catch{};y=await bunnyStatus(s.bunny_live_stream_id);}
   const onAir=y.primaryLive||y.backupLive,status=onAir?"broadcasting":y.readyToStart?"receiving":"waiting",now=new Date().toISOString();
   await adminClient.from("live_streams").update({tv_connection_state:onAir?"connected":"starting",tv_last_heartbeat_at:now,stream_url:s.bunny_playback_url}).eq("id",id).eq("user_id",s.user_id);
   await upsertFirebaseLiveMetadata(id,{status:onAir?"live":"starting",is_live:true,viewer_count:s.viewer_count||0,provider:"bunny",bunny_live_stream_id:s.bunny_live_stream_id,playback_url:s.bunny_playback_url||"",last_ping_ago:y.lastPingAgo,duration_seconds:y.duration});
   return json({ok:true,data:await contract("host",{on_air:onAir,output_mode:"bunny-live",bunny_status:{ready_to_start:y.readyToStart,primary_live:y.primaryLive,backup_live:y.backupLive,last_ping_ago:y.lastPingAgo,duration:y.duration},health:{provider:"bunny",ready_to_start:y.readyToStart,primary_live:y.primaryLive,backup_live:y.backupLive,last_ping_ago:y.lastPingAgo}}),error:null});
  }catch(e:any){const be=e instanceof BunnyStageError?e:new BunnyStageError("verify",e?.message||"Bunny state verification failed.");return json({ok:false,error:{code:"BUNNY_VERIFY_FAILED",message:be.message,phase:be.phase,http_status:be.httpStatus}},502)}
 }
 if(action==="stop"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can stop this TV broadcast."}},403);
  const now=new Date().toISOString();
  if(s.bunny_live_stream_id&&bunnyReady())try{await bunnyStop(s.bunny_live_stream_id)}catch{}
  await adminClient.from("tv_bunny_encoder_sessions").update({revoked_at:now}).eq("stream_id",id).is("revoked_at",null);
  const {error:e}=await adminClient.from("live_streams").update({is_live:false,ended_at:now,tv_connection_state:"offline",tv_last_heartbeat_at:null,tv_host_peer_id:null,viewer_count:0,stream_url:null}).eq("id",id).eq("user_id",s.user_id);
  if(e)return json({ok:false,error:{code:"TV_STOP_FAILED",message:"Could not stop this TV broadcast."}},409);
  try{await upsertFirebaseLiveMetadata(id,{status:"ended",is_live:false,ended_at:now,viewer_count:0,video_persistence:"ephemeral"});}catch(e:any){return json({ok:false,error:{code:"FIREBASE_METADATA_FAILED",message:e?.message||"Firebase metadata store is unavailable."}},503)}
  return json({ok:true,data:await contract("host",{on_air:false}),error:null});
 }
 if(action==="heartbeat"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can send a TV heartbeat."}},403);
  if(!s.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"Broadcast is not live."}},409);
  const state=["starting","connected","degraded","stale"].includes(b.connection_state)?b.connection_state:"degraded",count=Math.max(0,Math.min(100000,Number(b.viewer_count)||0)),peer=typeof b.peer_id==="string"&&b.peer_id.length<=128?b.peer_id:"",now=new Date().toISOString();
  const {error:e}=await adminClient.from("live_streams").update({tv_last_heartbeat_at:now,tv_connection_state:state,tv_host_peer_id:peer||null,viewer_count:count}).eq("id",id).eq("user_id",s.user_id).eq("is_live",true);
  if(e)return json({ok:false,error:{code:"TV_HEARTBEAT_FAILED",message:"Could not update TV broadcast health."}},409);
  try{await upsertFirebaseLiveMetadata(id,{status:state,is_live:true,viewer_count:count,last_heartbeat_at:now,provider:"bunny"});}catch(e:any){return json({ok:false,error:{code:"FIREBASE_METADATA_FAILED",message:e?.message||"Firebase metadata store is unavailable."}},503)}
  return json({ok:true,data:{heartbeat_ok:true,connection_state:state,viewer_count:count},error:null});
 }
 if(action==="guest-control-list"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can manage TV guests."}},403);
  const now=new Date().toISOString();
  const {data:rows,error:e}=await adminClient.from("tv_guest_invites").select("id,slot_number,expires_at,claimed_by,claimed_at,muted,blocked,used_at").eq("stream_id",id).gt("expires_at",now).order("slot_number",{ascending:true});
  if(e)return json({ok:false,error:{code:"GUEST_CONTROL_LIST_FAILED",message:"Could not load TV guest slots."}},409);
  return json({ok:true,data:{capacity:6,slots:(rows||[]).map((g:any)=>({id:g.id,slot:Number(g.slot_number),label:"Guest "+Number(g.slot_number),status:g.used_at?"connected":"invited",expires_at:g.expires_at,claimed_by:g.claimed_by??null,muted:Boolean(g.muted),blocked:Boolean(g.blocked)}))},error:null});
 }
 if(action==="guest-control"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can control TV guests."}},403);
  const slot=Number(b.guest_slot||0),control=typeof b.control==="string"?b.control:"";
  if(!Number.isInteger(slot)||slot<1||slot>6)return json({ok:false,error:{code:"GUEST_SLOT_INVALID",message:"Guest slot must be between 1 and 6."}},400);
  if(!["mute","unmute","block","unblock"].includes(control))return json({ok:false,error:{code:"GUEST_CONTROL_INVALID",message:"Unsupported guest control."}},400);
  const {data:g,error:ge}=await adminClient.from("tv_guest_invites").select("id,slot_number,expires_at,used_at").eq("stream_id",id).eq("slot_number",slot).gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(ge||!g)return json({ok:false,error:{code:"GUEST_SLOT_NOT_FOUND",message:"That guest slot is not currently allocated."}},404);
  const patch=control==="mute"?{muted:true}:control==="unmute"?{muted:false}:control==="block"?{blocked:true}: {blocked:false};
  const {error:ue}=await adminClient.from("tv_guest_invites").update(patch).eq("id",g.id);
  if(ue)return json({ok:false,error:{code:"GUEST_CONTROL_FAILED",message:"Could not update the guest control state."}},409);
  return json({ok:true,data:{slot,control,...patch},error:null});
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
 if((action==="viewer"||action==="guest")&&platformOwner&&!s.is_live)return json({ok:true,data:await contract(action==="guest"?"guest":"host",{preview:true,on_air:false}),error:null});
 if(!s.is_live)return json({ok:false,error:{code:"STREAM_ENDED",message:"Broadcast is no longer live."}},409);
 return json({ok:true,data:await contract(action==="viewer"?"viewer":"unknown"),error:null});
});