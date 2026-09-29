import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";\nconst secret = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store","Vary":"Origin, Access-Control-Request-Headers"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json",...cors}});
const client=(auth:string)=>createClient(url,key,{global:{headers:auth?{Authorization:auth}:{}},auth:{persistSession:false,autoRefreshToken:false}});\nconst admin=()=>createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,"0")).join("");
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,"0")).join("");

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
 const {data:stream,error}=await db.from("live_streams").select("id,user_id,is_live,title,description,viewer_count").eq("id",streamId).maybeSingle();
 if(error||!stream) return json({ok:false,error:{code:"STREAM_NOT_FOUND",message:"TV broadcast was not found."}},404);
 const user=auth.startsWith("Bearer ")?(await db.auth.getUser()).data.user:null;
 const owner=Boolean(user&&user.id===stream.user_id);
 const contract=(role:string)=>({provider:"native-p2p",room_id:streamId,room_type:"tv",role,signaling_topic:"tv:"+streamId,title:stream.title,viewer_count:stream.viewer_count??0,ice_servers:[]});

 if(action==="start"){
   if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can start this TV broadcast."}},403);
   const {data:updated,error:e}=await db.from("live_streams").update({is_live:true,started_at:new Date().toISOString(),ended_at:null,stream_url:null}).eq("id",streamId).eq("user_id",stream.user_id).select("id,user_id,is_live,title,description,viewer_count").single();
   if(e||!updated)return json({ok:false,error:{code:"TV_START_FAILED",message:"Could not start the TV broadcast."}},409);
   return json({ok:true,data:contract("host"),error:null});
 }
 if(action==="stop"){
   if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can stop this TV broadcast."}},403);
   const {error:e}=await db.from("live_streams").update({is_live:false,ended_at:new Date().toISOString(),stream_url:null}).eq("id",streamId).eq("user_id",stream.user_id);
   if(e)return json({ok:false,error:{code:"TV_STOP_FAILED",message:"Could not stop the TV broadcast."}},409);
   return json({ok:true,data:contract("host"),error:null});
 }
 if(action==="verify"){
   if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can verify this TV broadcast."}},403);
   if(!stream.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"TV broadcast is not live."}},409);
   return json({ok:true,data:{...contract("host"),on_air:true},error:null});
 }
 if(action==="create-guest"){
   if(!owner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can create a guest invite."}},403);
   if(!stream.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"Start the TV broadcast before inviting a guest."}},409);
   const token=randomToken();
   const {error:e}=await db.from("tv_guest_invites").insert({stream_id:streamId,token_hash:await hash(token),expires_at:new Date(Date.now()+3600000).toISOString()});
   if(e)return json({ok:false,error:{code:"GUEST_INVITE_FAILED",message:"Could not create the guest invite."}},409);
   return json({ok:true,data:{invite_token:token,room_id:streamId,signaling_topic:"tv:"+streamId},error:null});
 }
 if(action==="guest"){
   if(!stream.is_live)return json({ok:false,error:{code:"STREAM_ENDED",message:"Broadcast is no longer live."}},409);
   if(!inviteToken)return json({ok:false,error:{code:"INVITE_REQUIRED",message:"A TV guest invite is required."}},401);
   const inviteDb=secret?admin():db;\n   const {data:invite}=await inviteDb.from("tv_guest_invites").select("id,expires_at,used_at").eq("stream_id",streamId).eq("token_hash",await hash(inviteToken)).maybeSingle();
   if(!invite||invite.used_at||new Date(invite.expires_at).getTime()<=Date.now())return json({ok:false,error:{code:"INVITE_INVALID",message:"This TV guest invite is invalid or expired."}},401);
   return json({ok:true,data:{...contract("guest"),guest_token:inviteToken},error:null});
 }
 if(!stream.is_live)return json({ok:false,error:{code:"STREAM_ENDED",message:"Broadcast is no longer live."}},409);
 return json({ok:true,data:contract("viewer"),error:null});
});
