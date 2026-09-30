import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const secret = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const muxTokenId = Deno.env.get("MUX_TOKEN_ID") ?? "";
const muxTokenSecret = Deno.env.get("MUX_TOKEN_SECRET") ?? "";
const cloudflareTurnTokenId = Deno.env.get("CLOUDFLARE_TURN_TOKEN_ID") ?? "";
const cloudflareTurnApiToken = Deno.env.get("CLOUDFLARE_TURN_API_TOKEN") ?? "";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store","Vary":"Origin, Access-Control-Request-Headers"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json",...cors}});
const client=(auth:string)=>createClient(url,key,{global:{headers:auth?{Authorization:auth}:{}},auth:{persistSession:false,autoRefreshToken:false}});
const admin=()=>createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,"0")).join("");
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,"0")).join("");

let turnCache: { iceServers: any[]; expiresAt: number } | null = null;

async function iceServers() {
  const stun = { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };
  if (!cloudflareTurnTokenId || !cloudflareTurnApiToken) return [stun];

  if (turnCache && turnCache.expiresAt > Date.now()) return turnCache.iceServers;

  const response = await fetch(
    "https://rtc.live.cloudflare.com/v1/turn/keys/" +
      encodeURIComponent(cloudflareTurnTokenId) +
      "/credentials/generate-ice-servers",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + cloudflareTurnApiToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: 86400 }),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.iceServers) || !payload.iceServers.length) {
    throw new Error("Cloudflare TURN credentials could not be generated.");
  }

  const servers = payload.iceServers
    .filter((server: any) => Array.isArray(server?.urls) && server.urls.length)
    .map((server: any) => ({
      urls: server.urls,
      ...(server.username ? { username: server.username } : {}),
      ...(server.credential ? { credential: server.credential } : {}),
    }));

  if (!servers.length) throw new Error("Cloudflare TURN returned no usable ICE servers.");
  turnCache = { iceServers: servers, expiresAt: Date.now() + 30 * 60 * 1000 };
  return servers;
}

const muxConfigured = () => Boolean(muxTokenId && muxTokenSecret);
async function muxRequest(path: string, init: RequestInit = {}) {
  if (!muxConfigured()) throw new Error("Mux TV transport is not configured.");
  const auth = btoa(muxTokenId + ":" + muxTokenSecret);
  const r = await fetch("https://api.mux.com/video/v1/" + path, {
    ...init,
    headers: {
      "Authorization": "Basic " + auth,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const p = await r.json().catch(() => null);
  if (!r.ok) throw new Error(p?.error?.messages?.join("; ") || p?.error?.message || ("Mux API request failed (" + r.status + ")."));
  return p;
}

async function prepareMuxLiveStream(stream: any) {
  const p = await muxRequest("live-streams", {
    method: "POST",
    body: JSON.stringify({
      latency_mode: "low",
      reconnect_window: 120,
      max_continuous_duration: 43200,
      playback_policies: ["public"],
      new_asset_settings: { playback_policies: ["public"] },
      meta: { title: (stream.title || "Testagram TV Live").slice(0, 512) },
    }),
  });
  const data = p?.data;
  const playbackId = data?.playback_ids?.find((x: any) => x?.policy === "public")?.id;
  if (!data?.id || !data?.stream_key || !playbackId) throw new Error("Mux did not return a usable live stream, stream key, and playback ID.");
  return {
    live_stream_id: data.id,
    stream_key: data.stream_key,
    playback_id: playbackId,
    status: data.status || "idle",
    latency_mode: data.latency_mode || "low",
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
 if(action==="mux-encoder-config"){
   const tokenHash=await hash(typeof body.encoder_token==="string"?body.encoder_token:"");
   if(!tokenHash)return json({ok:false,error:{code:"ENCODER_TOKEN_REQUIRED",message:"Mux encoder session token is required."}},401);
   if(!secret)return json({ok:false,error:{code:"TV_CONTROL_MISCONFIGURED",message:"TV server secret is not configured."}},503);
   const adminDb=admin();
   const {data:session,error:sessionError}=await adminDb.from("tv_mux_encoder_sessions").select("id,stream_id,user_id,expires_at,revoked_at").eq("stream_id",streamId).eq("token_hash",tokenHash).maybeSingle();
   if(sessionError||!session||session.revoked_at||new Date(session.expires_at).getTime()<=Date.now())return json({ok:false,error:{code:"ENCODER_TOKEN_INVALID",message:"Mux encoder session is invalid or expired."}},401);
   const {data:encoderStream,error:encoderStreamError}=await adminDb.from("live_streams").select("id,user_id,is_live,tv_provider,mux_live_stream_id").eq("id",streamId).maybeSingle();
   if(encoderStreamError||!encoderStream||!encoderStream.is_live||encoderStream.tv_provider!=="mux"||!encoderStream.mux_live_stream_id)return json({ok:false,error:{code:"MUX_ENCODER_STREAM_INVALID",message:"The Mux TV stream is not active."}},409);
   if(encoderStream.user_id!==session.user_id)return json({ok:false,error:{code:"ENCODER_OWNER_MISMATCH",message:"Mux encoder session owner mismatch."}},403);
   const live=await muxRequest("live-streams/"+encodeURIComponent(encoderStream.mux_live_stream_id));
   const streamKey=live?.data?.stream_key;
   if(!streamKey)return json({ok:false,error:{code:"MUX_INGESTION_UNAVAILABLE",message:"Mux has not returned a usable stream key."}},502);
   await adminDb.from("tv_mux_encoder_sessions").update({claimed_at:new Date().toISOString()}).eq("id",session.id);
   return json({ok:true,data:{rtmps_ingestion_address:"rtmps://global-live.mux.com:443/app",stream_name:streamKey},error:null});
 }
 const {data:stream,error}=await db.from("live_streams").select("id,user_id,is_live,title,description,viewer_count,tv_provider,tv_connection_state,tv_last_heartbeat_at,tv_host_peer_id,mux_live_stream_id,mux_playback_id,mux_active_asset_id,mux_status,youtube_broadcast_id,youtube_stream_id,youtube_video_id").eq("id",streamId).maybeSingle();
 if(error||!stream) return json({ok:false,error:{code:"STREAM_NOT_FOUND",message:"TV broadcast was not found."}},404);
 const user=auth.startsWith("Bearer ")?(await db.auth.getUser()).data.user:null;
 const owner=Boolean(user&&user.id===stream.user_id);
 const provider="mux";
 const contract=(role:string)=>({provider,room_id:streamId,room_type:"tv",role,signaling_topic:"tv:"+streamId,title:stream.title,viewer_count:stream.viewer_count??0,ice_servers:await iceServers(),playback_id:stream.mux_playback_id||null,playback_url:stream.mux_playback_id?"https://stream.mux.com/"+stream.mux_playback_id+".m3u8":null,mux_live_stream_id:stream.mux_live_stream_id||null,mux_status:stream.mux_status||"idle"});

 if(action==="start"){
   if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can start this TV broadcast."}},403);
   if(!muxConfigured())return json({ok:false,error:{code:"MUX_NOT_CONFIGURED",message:"Mux TV transport credentials are not configured."}},503);
   if(!secret)return json({ok:false,error:{code:"TV_CONTROL_MISCONFIGURED",message:"TV server secret is not configured."}},503);
   const now=new Date().toISOString();
   let mux:any;
   try{mux=await prepareMuxLiveStream(stream);}catch(e:any){return json({ok:false,error:{code:"MUX_SETUP_FAILED",message:e?.message||"Could not prepare Mux Live."}},502);}
   const encoderToken=randomToken();
   const {error:sessionError}=await admin().from("tv_mux_encoder_sessions").insert({stream_id:streamId,user_id:stream.user_id,token_hash:await hash(encoderToken),expires_at:new Date(Date.now()+12*60*60*1000).toISOString()});
   if(sessionError)return json({ok:false,error:{code:"MUX_ENCODER_SESSION_FAILED",message:"Could not create the secure Mux encoder session."}},500);
   const {data:updated,error:e}=await db.from("live_streams").update({
     is_live:true,started_at:now,ended_at:null,stream_url:"https://stream.mux.com/"+mux.playback_id+".m3u8",
     tv_provider:"mux",tv_connection_state:"starting",tv_last_heartbeat_at:now,tv_host_peer_id:null,viewer_count:0,
     mux_live_stream_id:mux.live_stream_id,mux_playback_id:mux.playback_id,mux_active_asset_id:null,mux_status:mux.status||"idle"
   }).eq("id",streamId).eq("user_id",stream.user_id).select("id,user_id,is_live,title,description,viewer_count,tv_provider,mux_live_stream_id,mux_playback_id,mux_status").single();
   if(e||!updated)return json({ok:false,error:{code:"TV_START_FAILED",message:"Could not start the TV broadcast."}},409);
   return json({ok:true,data:{...contract("host"),mux:{live_stream_id:mux.live_stream_id,playback_id:mux.playback_id,latency_mode:mux.latency_mode,encoder_required:true,encoder_token:encoderToken}},error:null});
 }
 if(action==="stop"){
   if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can stop this TV broadcast."}},403);
   if(stream.mux_live_stream_id&&muxConfigured()){try{await muxRequest("live-streams/"+encodeURIComponent(stream.mux_live_stream_id)+"/disable",{method:"PUT"});}catch{}}
   await admin().from("tv_mux_encoder_sessions").update({revoked_at:new Date().toISOString()}).eq("stream_id",streamId).is("revoked_at",null);
   const {error:e}=await db.from("live_streams").update({is_live:false,ended_at:new Date().toISOString(),stream_url:null,tv_connection_state:"offline",tv_last_heartbeat_at:null,tv_host_peer_id:null,viewer_count:0,mux_status:"idle",mux_active_asset_id:null}).eq("id",streamId).eq("user_id",stream.user_id);
   if(e)return json({ok:false,error:{code:"TV_STOP_FAILED",message:"Could not stop the TV broadcast."}},409);
   return json({ok:true,data:contract("host"),error:null});
 }
 if(action==="verify"){
   if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can verify this TV broadcast."}},403);
   if(!stream.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"TV broadcast is not live."}},409);
   if(!stream.mux_live_stream_id)return json({ok:false,error:{code:"MUX_STREAM_MISSING",message:"Mux live stream is not configured."}},409);
   try{
     const p=await muxRequest("live-streams/"+encodeURIComponent(stream.mux_live_stream_id));
     const m=p?.data; const muxStatus=String(m?.status||"idle"); const active=muxStatus==="active"||Boolean(m?.active_asset_id);
     await db.from("live_streams").update({mux_status:muxStatus,mux_active_asset_id:m?.active_asset_id||null,tv_connection_state:active?"connected":"starting",tv_last_heartbeat_at:new Date().toISOString()}).eq("id",streamId).eq("user_id",stream.user_id);
     return json({ok:true,data:{...contract("host"),on_air:active,health:{provider:"mux",mux_status:muxStatus,active_asset_id:m?.active_asset_id||null,viewer_count:stream.viewer_count??0}},error:null});
   }catch(e:any){return json({ok:false,error:{code:"MUX_VERIFY_FAILED",message:e?.message||"Could not verify Mux Live."}},502);}
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
   const token=randomToken();
   const {error:e}=await db.from("tv_guest_invites").insert({stream_id:streamId,token_hash:await hash(token),expires_at:new Date(Date.now()+3600000).toISOString()});
   if(e)return json({ok:false,error:{code:"GUEST_INVITE_FAILED",message:"Could not create the guest invite."}},409);
   return json({ok:true,data:{invite_token:token,room_id:streamId,signaling_topic:"tv:"+streamId,ice_servers:await iceServers()},error:null});
 }
 if(action==="guest"){
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
 if(stream.mux_playback_id)return json({ok:true,data:{...contract("viewer"),playback_url:"https://stream.mux.com/"+stream.mux_playback_id+".m3u8"},error:null});
 return json({ok:false,error:{code:"TV_MEDIA_NOT_READY",message:"Mux playback is not ready for this broadcast."}},409);
