import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const mediaUrl = Deno.env.get("MEDIA_ENGINE_URL") ?? "";
const mediaSecret = Deno.env.get("MEDIA_ENGINE_SECRET") ?? "";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Max-Age":"600","Vary":"Origin, Access-Control-Request-Headers"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store",...cors}});
const enc=(value:string|Uint8Array)=>{const bytes=typeof value==="string"?new TextEncoder().encode(value):value;let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")};
const dec=(value:string)=>{const n=value.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((value.length+3)%4);const bytes=atob(n);return Uint8Array.from(bytes,c=>c.charCodeAt(0))};
const signToken=async(header:string,payload:Record<string,unknown>)=>{const h=enc(header);const b=enc(JSON.stringify(payload));const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(mediaSecret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(b)));return h+"."+b+"."+enc(sig)};
const verifyToken=async(token:string,expectedHeader:string)=>{try{const p=token.split(".");if(p.length!==3||dec(p[0]).length===0||new TextDecoder().decode(dec(p[0]))!==expectedHeader)return null;const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(mediaSecret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);if(!await crypto.subtle.verify("HMAC",key,dec(p[2]),new TextEncoder().encode(p[1])))return null;const payload=JSON.parse(new TextDecoder().decode(dec(p[1])));return typeof payload.exp==="number"&&payload.exp>Math.floor(Date.now()/1000)?payload:null}catch{return null}};
const getUser=async(auth:string)=>{const db=createClient(supabaseUrl,supabaseKey,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await db.auth.getUser();return error||!data.user?null:data.user};
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return json({ok:true});if(req.method!=="POST")return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"POST required"}},405);
 if(!supabaseUrl||!supabaseKey||!mediaUrl||!mediaSecret)return json({ok:false,error:{code:"MEDIA_ENGINE_NOT_CONFIGURED",message:"Testagram Media Engine is not configured",details:{missing:[!mediaUrl?"MEDIA_ENGINE_URL":null,!mediaSecret?"MEDIA_ENGINE_SECRET":null].filter(Boolean)}}},503);
 let body:any={};try{body=await req.json()}catch{return json({ok:false,error:{code:"INVALID_JSON",message:"JSON required"}},400)}
 const streamId=typeof body.stream_id==="string"?body.stream_id:"";const role=body.role==="host"||body.role==="guest"?"guest":body.role==="host"?"host":"viewer";
 if(!streamId)return json({ok:false,error:{code:"STREAM_ID_REQUIRED",message:"stream_id is required"}},400);
 const publicDb=createClient(supabaseUrl,supabaseKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:stream,error:streamError}=await publicDb.from("live_streams").select("id,user_id,is_live,title").eq("id",streamId).maybeSingle();
 if(streamError||!stream)return json({ok:false,error:{code:"STREAM_NOT_FOUND",message:"TV broadcast was not found."}},404);
 const auth=req.headers.get("authorization")||"";
 if(role==="host"){
   if(!auth.startsWith("Bearer "))return json({ok:false,error:{code:"AUTH_REQUIRED",message:"Sign in to broadcast."}},401);
   const user=await getUser(auth);if(!user||stream.user_id!==user.id)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can publish."}},403);
   const now=Math.floor(Date.now()/1000);const token=await signToken("testagram-media-v1",{role:"host",stream_id:stream.id,user_id:user.id,exp:now+3600});
   return json({ok:true,data:{token,ws_url:mediaUrl.replace(/\/$/,"")+"/ws",stream_id:stream.id,role:"host"},error:null});
 }
 if(!stream.is_live)return json({ok:false,error:{code:"STREAM_ENDED",message:"Broadcast is no longer live."}},409);
 if(role==="guest"){
   if(body.mode==="create"){
     if(!auth.startsWith("Bearer "))return json({ok:false,error:{code:"AUTH_REQUIRED",message:"Sign in as the broadcaster to invite a guest."}},401);
     const user=await getUser(auth);if(!user||stream.user_id!==user.id)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can create a guest invitation."}},403);
     const now=Math.floor(Date.now()/1000);const invite=await signToken("testagram-tv-guest-v1",{typ:"tv_guest_invite",stream_id:stream.id,host_id:user.id,jti:crypto.randomUUID(),exp:now+900});
     return json({ok:true,data:{invite_token:invite,stream_id:stream.id,expires_at:new Date((now+900)*1000).toISOString()},error:null});
   }
   const invite=typeof body.invite_token==="string"?await verifyToken(body.invite_token,"testagram-tv-guest-v1"):null;
   if(!invite||invite.typ!=="tv_guest_invite"||invite.stream_id!==stream.id||invite.host_id!==stream.user_id)return json({ok:false,error:{code:"INVALID_GUEST_INVITE",message:"This guest invitation is invalid or expired."}},401);
   const now=Math.floor(Date.now()/1000);const token=await signToken("testagram-media-v1",{role:"guest",stream_id:stream.id,user_id:"guest-"+crypto.randomUUID(),exp:now+3600});
   return json({ok:true,data:{token,ws_url:mediaUrl.replace(/\/$/,"")+"/ws",stream_id:stream.id,role:"guest"},error:null});
 }
 const now=Math.floor(Date.now()/1000);const token=await signToken("testagram-media-v1",{role:"viewer",stream_id:stream.id,user_id:"viewer-"+crypto.randomUUID(),exp:now+3600});
 return json({ok:true,data:{token,ws_url:mediaUrl.replace(/\/$/,"")+"/ws",stream_id:stream.id,role:"viewer"},error:null});
});