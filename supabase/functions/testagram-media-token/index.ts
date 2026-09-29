import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const mediaUrl = Deno.env.get("MEDIA_ENGINE_URL") ?? "";
const mediaSecret = Deno.env.get("MEDIA_ENGINE_SECRET") ?? "";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Max-Age":"600","Vary":"Origin, Access-Control-Request-Headers"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store",...cors}});
const enc=(value:string|Uint8Array)=>{const bytes=typeof value==="string"?new TextEncoder().encode(value):value;let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")};
const signToken=async(payload:Record<string,unknown>)=>{const h=enc("testagram-media-v1");const b=enc(JSON.stringify(payload));const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(mediaSecret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(b)));return h+"."+b+"."+enc(sig)};
const getUser=async(auth:string)=>{const db=createClient(supabaseUrl,supabaseKey,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await db.auth.getUser();return error||!data.user?null:data.user};

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return json({ok:true});
  if(req.method!=="POST") return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"POST required"}},405);
  if(!supabaseUrl||!supabaseKey) return json({ok:false,error:{code:"SUPABASE_NOT_CONFIGURED",message:"Supabase media authorization is not configured."}},503);
  let body:any={}; try{body=await req.json()}catch{return json({ok:false,error:{code:"INVALID_JSON",message:"JSON required"}},400);}
  const roomId=typeof body.room_id==="string"?body.room_id:"";
  const roomType=body.room_type==="call"||body.room_type==="space"||body.room_type==="tv"?body.room_type:"tv";
  const requestedRole=typeof body.role==="string"?body.role:"viewer";
  if(!roomId) return json({ok:false,error:{code:"ROOM_ID_REQUIRED",message:"room_id is required"}},400);

  const publicDb=createClient(supabaseUrl,supabaseKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const auth=req.headers.get("authorization")||"";
  const now=Math.floor(Date.now()/1000);

  if(roomType==="tv") return json({ok:false,error:{code:"TV_MEDIA_MIGRATED",message:"TV media authorization is owned by the tv-media-control Edge Function."}},410);

  if(!auth.startsWith("Bearer ")) return json({ok:false,error:{code:"AUTH_REQUIRED",message:"Authentication required."}},401);
  const user=await getUser(auth); if(!user) return json({ok:false,error:{code:"AUTH_REQUIRED",message:"Authentication required."}},401);

  if(roomType==="space"){
    const {data:space,error:spaceError}=await publicDb.from("spaces").select("id,host_id,is_live,room_name").eq("id",roomId).maybeSingle();
    if(spaceError||!space) return json({ok:false,error:{code:"SPACE_NOT_FOUND",message:"Audio Space was not found."}},404);
    if(!space.is_live) return json({ok:false,error:{code:"SPACE_ENDED",message:"Audio Space is not live."}},409);
    const {data:member}=await publicDb.from("space_participants").select("role,left_at").eq("space_id",roomId).eq("user_id",user.id).is("left_at",null).maybeSingle();
    const isHost=space.host_id===user.id;
    const role=requestedRole==="speaker"?"speaker":"listener";
    if(!isHost&&!member) return json({ok:false,error:{code:"SPACE_MEMBERSHIP_REQUIRED",message:"Join the Space before connecting to media."}},403);
    if(role==="speaker"&&!isHost&&member?.role!=="speaker") return json({ok:false,error:{code:"SPEAKER_REQUIRED",message:"Speaker permission is required."}},403);
    const token=await signToken({mode:"space",room_id:space.id,role:isHost?"host":role,user_id:user.id,exp:now+3600});
    return json({ok:true,data:{token,ws_url:mediaWsUrl,room_id:space.id,room_type:"space",role:isHost?"host":role,ice_servers:iceServers},error:null});
  }

  const {data:call,error:callError}=await publicDb.from("calls").select("id,conversation_id,created_by,room_name,kind,status,metadata").eq("id",roomId).maybeSingle();
  if(callError||!call) return json({ok:false,error:{code:"CALL_NOT_FOUND",message:"Call was not found."}},404);
  if(!["ringing","active"].includes(call.status)) return json({ok:false,error:{code:"CALL_ENDED",message:"Call is no longer active."}},409);
  const {data:membership}=await publicDb.from("conversation_members").select("user_id").eq("conversation_id",call.conversation_id).eq("user_id",user.id).maybeSingle();
  if(!membership) return json({ok:false,error:{code:"CALL_MEMBERSHIP_REQUIRED",message:"Conversation membership is required."}},403);
  const {data:participant}=await publicDb.from("call_participants").select("joined_at,left_at").eq("call_id",call.id).eq("user_id",user.id).maybeSingle();
  if(!participant||participant.left_at) return json({ok:false,error:{code:"CALL_JOIN_REQUIRED",message:"Join the call before connecting to media."}},403);
  const token=await signToken({mode:"call",room_id:call.id,role:"participant",user_id:user.id,kind:call.kind,exp:now+3600});
  return json({ok:true,data:{token,ws_url:mediaWsUrl,room_id:call.id,room_type:"call",role:"participant",kind:call.kind,conversation_id:call.conversation_id,ice_servers:iceServers},error:null});
});
