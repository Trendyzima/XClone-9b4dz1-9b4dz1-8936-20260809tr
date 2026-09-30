import "jsr:@supabase/supabase-js@2";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url=Deno.env.get("SUPABASE_URL")??"",key=Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??Deno.env.get("SUPABASE_ANON_KEY")??"",secret=Deno.env.get("SUPABASE_SECRET_KEY")??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const cfAccount=Deno.env.get("TESTAGRAM_CLOUDFLARE_ACCOUNT_ID")??Deno.env.get("CLOUDFLARE_ACCOUNT_ID")??"",cfToken=Deno.env.get("TESTAGRAM_CLOUDFLARE_STREAM_API_TOKEN")??Deno.env.get("CLOUDFLARE_STREAM_API_TOKEN")??Deno.env.get("CLOUDFLARE_API_TOKEN")??"";
const turnId=Deno.env.get("CLOUDFLARE_TURN_TOKEN_ID")??"",turnToken=Deno.env.get("CLOUDFLARE_TURN_API_TOKEN")??"";
const ytUrl=Deno.env.get("YOUTUBE_RTMP_URL")??"rtmps://a.rtmp.youtube.com/live2",ytKey=Deno.env.get("YOUTUBE_STREAM_KEY")??"";
const ytClientId=Deno.env.get("YOUTUBE_CLIENT_ID")??"",ytClientSecret=Deno.env.get("YOUTUBE_CLIENT_SECRET")??"",ytRefresh=Deno.env.get("YOUTUBE_REFRESH_TOKEN")??"";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"Content-Type":"application/json",...cors}});
const db=(a:string)=>createClient(url,key,{global:{headers:a?{Authorization:a}:{}},auth:{persistSession:false,autoRefreshToken:false}});
const admin=()=>createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,"0")).join("");
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,"0")).join("");
const cfReady=()=>Boolean(cfAccount&&cfToken),ytReady=()=>Boolean(ytKey),ytApiReady=()=>Boolean(ytClientId&&ytClientSecret&&ytRefresh&&ytKey);
class YouTubeStageError extends Error {
  phase:string;
  httpStatus:number|null;
  reason:string|null;
  constructor(phase:string,message:string,httpStatus:number|null=null,reason:string|null=null){
    super(message);this.name="YouTubeStageError";this.phase=phase;this.httpStatus=httpStatus;this.reason=reason;
  }
}
async function ytToken(){
 if(!ytApiReady())throw new YouTubeStageError("authorization","YouTube API lifecycle credentials are not configured.",null,"credentials_missing");
 const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:ytClientId,client_secret:ytClientSecret,refresh_token:ytRefresh,grant_type:"refresh_token"})});
 const p=await r.json().catch(()=>null);
 if(!r.ok||!p?.access_token)throw new YouTubeStageError("authorization","YouTube OAuth refresh failed: "+(p?.error_description||p?.error||"unknown error"),r.status,String(p?.error||"oauth_refresh_failed"));
 return String(p.access_token);
}
async function ytApi(path:string,init:RequestInit={},phase="api"){
 let token:string;
 try{token=await ytToken()}catch(e){throw e}
 const r=await fetch("https://www.googleapis.com/youtube/v3/"+path,{...init,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...(init.headers||{})}});
 const p=await r.json().catch(()=>null);
 if(!r.ok){
   const reason=String(p?.error?.errors?.[0]?.reason||p?.error?.message||"request_failed");
   throw new YouTubeStageError(phase,"YouTube API "+r.status+": "+reason,r.status,reason);
 }
 return p;
}
async function ytPrepare(s:any){
 let streams:any;
 try{streams=await ytApi("liveStreams?part=id,snippet,cdn,status&mine=true&maxResults=50",{}, "stream_lookup")}catch(e){throw e}
 const stream=(streams?.items||[]).find((x:any)=>String(x?.cdn?.ingestionInfo?.streamName||"")===ytKey);
 if(!stream?.id)throw new YouTubeStageError("stream_lookup","Configured YOUTUBE_STREAM_KEY does not match a stream owned by the authorized YouTube channel.",200,"stream_not_found");
 const now=new Date(Date.now()+30000).toISOString();
 let broadcast:any;
 try{
   broadcast=await ytApi("liveBroadcasts?part=snippet,status,contentDetails",{method:"POST",body:JSON.stringify({snippet:{title:String(s.title||"Testagram TV Live").slice(0,100),description:String(s.description||"Live from Testagram TV Studio").slice(0,5000),scheduledStartTime:now},status:{privacyStatus:"unlisted"},contentDetails:{enableAutoStart:true,enableAutoStop:true,enableEmbed:true,enableDvr:true,recordFromStart:true,monitorStream:{enableMonitorStream:false},latencyPreference:"low"}})},"broadcast_create");
 }catch(e){throw e}
 if(!broadcast?.id)throw new YouTubeStageError("broadcast_create","YouTube did not return a broadcast id.",200,"broadcast_id_missing");
 try{
   await ytApi("liveBroadcasts/bind?part=id,snippet,contentDetails&id="+encodeURIComponent(broadcast.id)+"&streamId="+encodeURIComponent(stream.id),{method:"POST",body:"{}"},"bind");
 }catch(e){
   try{await ytTransitionComplete(String(broadcast.id))}catch{}
   throw e;
 }
 return {broadcastId:String(broadcast.id),streamId:String(stream.id),videoId:String(broadcast.id),streamStatus:String(stream?.status?.streamStatus||"created"),broadcastStatus:String(broadcast?.status?.lifeCycleStatus||"created")};
}
async function ytState(broadcastId:string,streamId:string){
 const [s,b]=await Promise.all([
   ytApi("liveStreams?part=id,cdn,status&id="+encodeURIComponent(streamId),{},"stream_state"),
   ytApi("liveBroadcasts?part=id,status,contentDetails&id="+encodeURIComponent(broadcastId),{},"broadcast_state")
 ]);
 const stream=s?.items?.[0]||null,bc=b?.items?.[0]||null;
 return {stream,broadcast:bc,streamStatus:String(stream?.status?.streamStatus||"unknown"),broadcastStatus:String(bc?.status?.lifeCycleStatus||"unknown"),onAir:String(stream?.status?.streamStatus)==="active"&&["live","liveStarting"].includes(String(bc?.status?.lifeCycleStatus))};
}
async function ytTransitionLive(id:string){return ytApi("liveBroadcasts/transition?part=id,status&id="+encodeURIComponent(id)+"&broadcastStatus=live",{method:"POST",body:"{}"},"broadcast_transition");}
async function ytTransitionComplete(id:string){return ytApi("liveBroadcasts/transition?part=id,status&id="+encodeURIComponent(id)+"&broadcastStatus=complete",{method:"POST",body:"{}"},"broadcast_complete");}
async function cf(path:string,init:RequestInit={}){
 if(!cfReady())throw new Error("Cloudflare Stream transport is not configured.");
 const r=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(cfAccount)+"/stream/"+path,{...init,headers:{Authorization:"Bearer "+cfToken,"Content-Type":"application/json",...(init.headers||{})}});
 const p=await r.json().catch(()=>null);
 if(!r.ok||p?.success===false){
   const e=p?.errors?.[0]||{};
   const code=String(e?.code||"unknown");
   const message=String(e?.message||"Cloudflare Stream API request failed ("+r.status+").");
   throw new Error("Cloudflare Stream "+path+" failed: HTTP "+r.status+" code="+code+" · "+message);
 }
 return p;
}
async function ice(){
 const stun={urls:["stun:stun.cloudflare.com:3478","stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]};if(!turnId||!turnToken)return[stun];
 try{
  const r=await fetch("https://rtc.live.cloudflare.com/v1/turn/keys/"+encodeURIComponent(turnId)+"/credentials/generate-ice-servers",{method:"POST",headers:{Authorization:"Bearer "+turnToken,"Content-Type":"application/json"},body:JSON.stringify({ttl:86400})});
  const p=await r.json().catch(()=>null);if(!r.ok||!Array.isArray(p?.iceServers)||!p.iceServers.length)return[stun];
  const servers=p.iceServers.filter((s:any)=>Array.isArray(s?.urls)&&s.urls.length).map((s:any)=>({urls:s.urls,...(s.username?{username:s.username}:{}),...(s.credential?{credential:s.credential}:{})}));
  return servers.length?servers:[stun];
 }catch{return[stun]}
}
async function createInput(s:any){
 const p=await cf("live_inputs",{method:"POST",headers:{"Idempotency-Key":"testagram-tv-"+s.id},body:JSON.stringify({enabled:true,preferLowLatency:true,meta:{name:(s.title||"Testagram TV Live").slice(0,512),testagram_stream_id:s.id},recording:{mode:"automatic",requireSignedURLs:false}})});
 const x=p?.result;if(!x?.uid||!x?.rtmps?.url||!x?.rtmps?.streamKey)throw new Error("Cloudflare Stream did not return usable Live Input credentials.");
 return {inputId:String(x.uid),rtmpsUrl:String(x.rtmps.url),streamKey:String(x.rtmps.streamKey),playbackUrl:x?.playback?.hls||null,status:String(x?.status||"new")};
}
async function createYT(id:string){if(!ytReady())return null;const p=await cf("live_inputs/"+encodeURIComponent(id)+"/outputs",{method:"POST",body:JSON.stringify({url:ytUrl,streamKey:ytKey})});if(!p?.result?.uid)throw new Error("Cloudflare Stream did not create the YouTube output.");return{id:String(p.result.uid),status:p.result.enabled===false?"disabled":"enabled"};}
async function liveState(id:string){
 const input=(await cf("live_inputs/"+encodeURIComponent(id)))?.result||{},videos=(await cf("live_inputs/"+encodeURIComponent(id)+"/videos"))?.result;
 const video=Array.isArray(videos)?videos.find((v:any)=>v?.status?.state==="live-inprogress"):null;
 return{input,video,playbackUrl:video?.playback?.hls||input?.playback?.hls||null,onAir:Boolean(video)};
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return json({ok:true});if(req.method!=="POST")return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"POST required."}},405);if(!url||!key)return json({ok:false,error:{code:"SUPABASE_NOT_CONFIGURED",message:"Supabase TV control is not configured."}},503);
 let b:any;try{b=await req.json()}catch{return json({ok:false,error:{code:"INVALID_JSON",message:"JSON required."}},400)}
 const id=typeof b.stream_id==="string"?b.stream_id:"",action=typeof b.action==="string"?b.action:"viewer",invite=typeof b.invite_token==="string"?b.invite_token:"",requestedProvider=typeof b.provider==="string"?b.provider:"dual";if(!id)return json({ok:false,error:{code:"STREAM_ID_REQUIRED",message:"stream_id is required."}},400);
 const auth=req.headers.get("authorization")||"",client=db(auth);
 if(action==="cloudflare-encoder-config"){
  const h=await hash(typeof b.encoder_token==="string"?b.encoder_token:"");if(!h)return json({ok:false,error:{code:"ENCODER_TOKEN_REQUIRED",message:"Cloudflare encoder session token is required."}},401);if(!secret)return json({ok:false,error:{code:"TV_CONTROL_MISCONFIGURED",message:"TV server secret is not configured."}},503);
  const a=admin(),{data:s,error:se}=await a.from("tv_cloudflare_encoder_sessions").select("id,stream_id,user_id,expires_at,revoked_at").eq("stream_id",id).eq("token_hash",h).maybeSingle();
  if(se||!s||s.revoked_at||new Date(s.expires_at).getTime()<=Date.now())return json({ok:false,error:{code:"ENCODER_TOKEN_INVALID",message:"Cloudflare encoder session is invalid or expired."}},401);
  const {data:st,error:ee}=await a.from("live_streams").select("id,user_id,is_live,tv_provider,cloudflare_input_id").eq("id",id).maybeSingle();
  if(ee||!st||!st.is_live||st.tv_provider!=="cloudflare"||!st.cloudflare_input_id)return json({ok:false,error:{code:"CLOUDFLARE_ENCODER_STREAM_INVALID",message:"The Cloudflare TV stream is not active."}},409);
  if(st.user_id!==s.user_id)return json({ok:false,error:{code:"ENCODER_OWNER_MISMATCH",message:"Cloudflare encoder session owner mismatch."}},403);
  const x=(await cf("live_inputs/"+encodeURIComponent(st.cloudflare_input_id)))?.result;if(!x?.rtmps?.url||!x?.rtmps?.streamKey)return json({ok:false,error:{code:"CLOUDFLARE_INGESTION_UNAVAILABLE",message:"Cloudflare has not returned usable RTMPS credentials."}},502);
  await a.from("tv_cloudflare_encoder_sessions").update({claimed_at:new Date().toISOString()}).eq("id",s.id);
  return json({ok:true,data:{rtmps_ingestion_address:String(x.rtmps.url),stream_name:String(x.rtmps.streamKey)},error:null});
 }
 const {data:s,error}=await client.from("live_streams").select("id,user_id,is_live,title,description,viewer_count,tv_provider,tv_connection_state,tv_last_heartbeat_at,tv_host_peer_id,cloudflare_input_id,cloudflare_output_id,cloudflare_video_id,cloudflare_playback_url,youtube_output_id,youtube_broadcast_id,youtube_stream_id,youtube_video_id,youtube_status,youtube_error").eq("id",id).maybeSingle();
 if(error||!s)return json({ok:false,error:{code:"STREAM_NOT_FOUND",message:"TV broadcast was not found."}},404);
 const user=auth.startsWith("Bearer ")?(await client.auth.getUser()).data.user:null,owner=Boolean(user&&user.id===s.user_id);
 const contract=async(role:string,extra:any={})=>({provider:"dual",room_id:id,room_type:"tv",role,signaling_topic:"tv:"+id,title:s.title,viewer_count:s.viewer_count??0,ice_servers:await ice(),playback_id:s.tv_provider==="youtube"?(s.youtube_video_id||s.youtube_broadcast_id||null):(s.cloudflare_video_id||s.cloudflare_input_id||null),playback_url:s.tv_provider==="youtube"?(s.youtube_video_id||s.youtube_broadcast_id?"https://www.youtube.com/embed/"+encodeURIComponent(s.youtube_video_id||s.youtube_broadcast_id)+"?autoplay=1&playsinline=1&enablejsapi=1":null):(s.cloudflare_playback_url||null),cloudflare_input_id:s.cloudflare_input_id||null,cloudflare_video_id:s.cloudflare_video_id||null,cloudflare_status:s.tv_connection_state||"offline",testagram:{status:s.tv_connection_state||"offline",playback_url:s.cloudflare_playback_url||null,input_id:s.cloudflare_input_id||null,video_id:s.cloudflare_video_id||null},youtube:{enabled:ytApiReady()||ytReady(),status:s.youtube_status||"disabled",output_id:s.youtube_output_id||null,broadcast_id:s.youtube_broadcast_id||null,stream_id:s.youtube_stream_id||null,video_id:s.youtube_video_id||s.youtube_broadcast_id||null,error:s.youtube_error||null},...extra});
 if(action==="start"){
  if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can start this TV broadcast."}},403);
  if(s.is_live)return json({ok:false,error:{code:"STREAM_ALREADY_LIVE",message:"This TV broadcast is already live."}},409);
  if(requestedProvider==="youtube"||requestedProvider==="native-p2p")return json({ok:false,error:{code:"DUAL_OUTPUT_REQUIRED",message:"Testagram TV uses Cloudflare for Testagram delivery and YouTube as an independent parallel output."}},409);
  if(!cfReady())return json({ok:false,error:{code:"CLOUDFLARE_NOT_CONFIGURED",message:"Cloudflare Stream credentials are not configured."}},503);
  if(!secret)return json({ok:false,error:{code:"TV_CONTROL_MISCONFIGURED",message:"TV server secret is not configured."}},503);

  let x:any;
  try{x=await createInput(s)}catch(e:any){return json({ok:false,error:{code:"CLOUDFLARE_SETUP_FAILED",message:e?.message||"Could not prepare Testagram live delivery."}},502)}

  const enc=randomToken(),a=admin();
  const {error:se}=await a.from("tv_cloudflare_encoder_sessions").insert({stream_id:id,user_id:s.user_id,token_hash:await hash(enc),expires_at:new Date(Date.now()+12*60*60*1000).toISOString()});
  if(se){try{await cf("live_inputs/"+encodeURIComponent(x.inputId),{method:"DELETE"})}catch{};return json({ok:false,error:{code:"CLOUDFLARE_ENCODER_SESSION_FAILED",message:"Could not create the secure Testagram encoder session."}},500)}

  const {error:ue}=await a.from("live_streams").update({
    is_live:true,started_at:new Date().toISOString(),ended_at:null,stream_url:x.playbackUrl,
    tv_provider:"cloudflare",tv_connection_state:"starting",tv_last_heartbeat_at:new Date().toISOString(),
    tv_host_peer_id:null,viewer_count:0,cloudflare_input_id:x.inputId,cloudflare_output_id:null,
    cloudflare_video_id:null,cloudflare_playback_url:x.playbackUrl,youtube_output_id:null,
    youtube_broadcast_id:null,youtube_stream_id:null,youtube_video_id:null,
    youtube_status:ytApiReady()?"preparing":"disabled",youtube_error:ytApiReady()?null:"youtube_credentials_missing"
  }).eq("id",id).eq("user_id",s.user_id);
  if(ue){
    await a.from("tv_cloudflare_encoder_sessions").update({revoked_at:new Date().toISOString()}).eq("stream_id",id).eq("token_hash",await hash(enc));
    try{await cf("live_inputs/"+encodeURIComponent(x.inputId),{method:"DELETE"})}catch{}
    return json({ok:false,error:{code:"TV_START_FAILED",message:"Could not start the Testagram live broadcast."}},409);
  }

  // YouTube is deliberately best-effort here. Testagram is already live and remains
  // live if any YouTube API stage or output provisioning fails.
  let y:any=null, youtubeError:any=null;
  if(ytApiReady()){
    try{
      y=await ytPrepare(s);
      await a.from("live_streams").update({
        youtube_broadcast_id:y.broadcastId,youtube_stream_id:y.streamId,youtube_video_id:y.videoId,
        youtube_status:"prepared",youtube_error:null
      }).eq("id",id).eq("user_id",s.user_id);
      try{
        const yo=await createYT(x.inputId);
        await a.from("live_streams").update({youtube_output_id:yo?.id||null,youtube_status:yo?"ingesting":"prepared",youtube_error:null}).eq("id",id).eq("user_id",s.user_id);
      }catch(e:any){
        youtubeError={phase:"output_create",message:e?.message||"Cloudflare could not create the YouTube output."};
        await a.from("live_streams").update({youtube_status:"error",youtube_error:JSON.stringify(youtubeError)}).eq("id",id).eq("user_id",s.user_id);
      }
    }catch(e:any){
      const ye=e instanceof YouTubeStageError?e:new YouTubeStageError("unknown",e?.message||"YouTube preparation failed.");
      youtubeError={phase:ye.phase,http_status:ye.httpStatus,reason:ye.reason,message:ye.message};
      await a.from("live_streams").update({youtube_status:"error",youtube_error:JSON.stringify(youtubeError)}).eq("id",id).eq("user_id",s.user_id);
    }
  }

  return json({ok:true,data:{...(await contract("host",{
    on_air:false,
    output_mode:"dual",
    youtube:{enabled:ytApiReady(),status:youtubeError?"error":(y?"ingesting":"disabled"),output_id:null,broadcast_id:y?.broadcastId||null,stream_id:y?.streamId||null,video_id:y?.videoId||null,error:youtubeError}
  })),cloudflare:{input_id:x.inputId,playback_url:x.playbackUrl,encoder_required:true,encoder_token:enc},youtube:{enabled:ytApiReady(),status:youtubeError?"error":(y?"ingesting":"disabled"),broadcast_id:y?.broadcastId||null,stream_id:y?.streamId||null,video_id:y?.videoId||null,error:youtubeError}},error:null});
 }
 if(action==="stop"){
  if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can stop this TV broadcast."}},403);
  if(s.youtube_broadcast_id&&ytApiReady())try{await ytTransitionComplete(s.youtube_broadcast_id)}catch{}
  if(s.cloudflare_input_id&&cfReady())try{
   if(s.cloudflare_output_id)try{await cf("live_inputs/"+encodeURIComponent(s.cloudflare_input_id)+"/outputs/"+encodeURIComponent(s.cloudflare_output_id),{method:"DELETE"})}catch{}
   await cf("live_inputs/"+encodeURIComponent(s.cloudflare_input_id),{method:"PUT",body:JSON.stringify({enabled:false})})
  }catch{}
  const a=admin();await a.from("tv_cloudflare_encoder_sessions").update({revoked_at:new Date().toISOString()}).eq("stream_id",id).is("revoked_at",null);
  const {error:e}=await a.from("live_streams").update({is_live:false,ended_at:new Date().toISOString(),tv_connection_state:"offline",tv_last_heartbeat_at:null,tv_host_peer_id:null,viewer_count:0,cloudflare_video_id:null,youtube_status:"stopped",youtube_error:null}).eq("id",id).eq("user_id",s.user_id);if(e)return json({ok:false,error:{code:"TV_STOP_FAILED",message:"Could not stop the TV broadcast."}},409);return json({ok:true,data:await contract("host"),error:null});
 }
 if(action==="verify"){
  if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can verify this TV broadcast."}},403);
  if(!s.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"TV broadcast is not live."}},409);
  if(!s.cloudflare_input_id)return json({ok:false,error:{code:"CLOUDFLARE_INPUT_MISSING",message:"Cloudflare Live Input is not configured."}},409);
  try{
    const x=await liveState(s.cloudflare_input_id);
    let youtube=s.youtube_status||"disabled";
    let youtubeHealth:any={status:youtube,error:s.youtube_error||null};
    if(s.youtube_broadcast_id&&s.youtube_stream_id&&ytApiReady()){
      try{
        const y=await ytState(s.youtube_broadcast_id,s.youtube_stream_id);
        let ytOnAir=y.onAir;
        if(y.streamStatus==="active"&&y.broadcastStatus!=="live"){
          try{await ytTransitionLive(s.youtube_broadcast_id)}catch{}
          const y2=await ytState(s.youtube_broadcast_id,s.youtube_stream_id);
          ytOnAir=y2.onAir;
          youtubeHealth={status:ytOnAir?"broadcasting":y2.streamStatus,error:null,stream_status:y2.streamStatus,broadcast_status:y2.broadcastStatus};
          youtube=ytOnAir?"broadcasting":y2.streamStatus==="active"?"receiving":y2.broadcastStatus;
        }else{
          youtubeHealth={status:ytOnAir?"broadcasting":y.streamStatus,error:null,stream_status:y.streamStatus,broadcast_status:y.broadcastStatus};
          youtube=ytOnAir?"broadcasting":y.streamStatus==="active"?"receiving":y.broadcastStatus;
        }
      }catch(e:any){
        const ye=e instanceof YouTubeStageError?e:new YouTubeStageError("verify",e?.message||"YouTube state verification failed.");
        youtube="error";
        youtubeHealth={status:"error",phase:ye.phase,http_status:ye.httpStatus,reason:ye.reason,error:ye.message};
      }
    }
    const a=admin();
    await a.from("live_streams").update({
      cloudflare_video_id:x.video?.uid||null,
      cloudflare_playback_url:x.playbackUrl||s.cloudflare_playback_url||null,
      stream_url:x.playbackUrl||s.cloudflare_playback_url||null,
      tv_connection_state:x.onAir?"connected":String(x.input?.status||"starting"),
      tv_last_heartbeat_at:new Date().toISOString(),
      youtube_status:youtube,
      youtube_error:youtubeHealth.status==="error"?JSON.stringify(youtubeHealth):null
    }).eq("id",id).eq("user_id",s.user_id);
    return json({ok:true,data:await contract("host",{
      on_air:x.onAir,
      output_mode:"dual",
      cloudflare_input_status:x.input?.status||"unknown",
      cloudflare_video_id:x.video?.uid||null,
      playback_url:x.playbackUrl||s.cloudflare_playback_url||null,
      youtube_stream_status:youtubeHealth.stream_status||null,
      youtube_broadcast_status:youtubeHealth.broadcast_status||null,
      health:{provider:"dual",cloudflare_input_status:x.input?.status||"unknown",cloudflare_video_state:x.video?.status?.state||"idle",playback_url:x.playbackUrl||null,youtube:youtubeHealth}
    }),error:null});
  }catch(e:any){
    return json({ok:false,error:{code:"CLOUDFLARE_VERIFY_FAILED",message:e?.message||"Could not verify Testagram live delivery."}},502);
  }
 }
 if(action==="heartbeat"){
  if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can send a TV heartbeat."}},403);if(!s.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"Broadcast is not live."}},409);
  const state=["starting","connected","degraded","stale"].includes(b.connection_state)?b.connection_state:"degraded",count=Math.max(0,Math.min(100000,Number(b.viewer_count)||0)),peer=typeof b.peer_id==="string"&&b.peer_id.length<=128?b.peer_id:"";const {error:e}=await admin().from("live_streams").update({tv_last_heartbeat_at:new Date().toISOString(),tv_connection_state:state,tv_host_peer_id:peer||null,viewer_count:count}).eq("id",id).eq("user_id",s.user_id).eq("is_live",true);if(e)return json({ok:false,error:{code:"TV_HEARTBEAT_FAILED",message:"Could not update TV broadcast health."}},409);return json({ok:true,data:{heartbeat_ok:true,connection_state:state,viewer_count:count},error:null});
 }
 if(action==="create-guest"){
  if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can create a guest invite."}},403);if(!s.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"Start the TV broadcast before inviting a guest."}},409);const t=randomToken(),{error:e}=await admin().from("tv_guest_invites").insert({stream_id:id,token_hash:await hash(t),expires_at:new Date(Date.now()+3600000).toISOString()});if(e)return json({ok:false,error:{code:"GUEST_INVITE_FAILED",message:"Could not create the guest invite."}},409);return json({ok:true,data:{invite_token:t,room_id:id,signaling_topic:"tv:"+id,ice_servers:await ice()},error:null});
 }
 if(action==="guest"){
  if(!s.is_live)return json({ok:false,error:{code:"STREAM_ENDED",message:"Broadcast is no longer live."}},409);if(!invite)return json({ok:false,error:{code:"INVITE_REQUIRED",message:"A TV guest invite is required."}},401);if(!user)return json({ok:false,error:{code:"AUTH_REQUIRED",message:"Authentication is required to join the TV guest session."}},401);if(!secret)return json({ok:false,error:{code:"TV_CONTROL_MISCONFIGURED",message:"TV guest claiming requires the Supabase server secret."}},503);
  const now=new Date().toISOString(),{data:claimed,error:e}=await admin().from("tv_guest_invites").update({used_at:now,claimed_by:user.id,claimed_at:now}).eq("stream_id",id).eq("token_hash",await hash(invite)).is("used_at",null).gt("expires_at",now).select("id").maybeSingle();if(e||!claimed)return json({ok:false,error:{code:"INVITE_INVALID",message:"This TV guest invite is invalid, expired, or already claimed."}},401);return json({ok:true,data:{...(await contract("guest")),guest_token:invite},error:null});
 }
 if(!s.is_live)return json({ok:false,error:{code:"STREAM_ENDED",message:"Broadcast is no longer live."}},409);return json({ok:true,data:await contract(action==="viewer"?"viewer":"unknown"),error:null});
});
// TV production source gate: keep GitHub reconciliation attached to the deployed dual-output control path.
