import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl=Deno.env.get("SUPABASE_URL")??"";
const supabaseKey=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??"";
const livekitUrl=Deno.env.get("LIVEKIT_URL")??"";
const livekitApiKey=Deno.env.get("LIVEKIT_API_KEY")??"";
const livekitApiSecret=Deno.env.get("LIVEKIT_API_SECRET")??"";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"}});
const enc=(v:string|Uint8Array)=>{const b=typeof v==="string"?new TextEncoder().encode(v):v;let s="";for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")};
const dec=(v:string)=>{const n=v.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((v.length+3)%4);const b=atob(n);return Uint8Array.from(b,c=>c.charCodeAt(0))};
async function sign(p:Record<string,unknown>){const h=enc(JSON.stringify({alg:"HS256",typ:"JWT"})),b=enc(JSON.stringify(p)),i=h+"."+b;const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(livekitApiSecret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(i)));return i+"."+enc(s)}
async function verify(t:string){try{const p=t.split(".");if(p.length!==3)return null;const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(livekitApiSecret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);if(!await crypto.subtle.verify("HMAC",k,dec(p[2]),new TextEncoder().encode(p[0]+"."+p[1])))return null;const x=JSON.parse(new TextDecoder().decode(dec(p[1])));return typeof x.exp==="number"&&x.exp>Math.floor(Date.now()/1000)?x:null}catch{return null}}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return json({ok:true});
 if(req.method!=="POST")return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"POST required"}},405);
 if(!supabaseUrl||!supabaseKey||!livekitUrl||!livekitApiKey||!livekitApiSecret)return json({ok:false,error:{code:"LIVEKIT_NOT_CONFIGURED",message:"Live guest service is not configured"}},503);
 let body:any={};try{body=await req.json()}catch{return json({ok:false,error:{code:"INVALID_JSON",message:"JSON required"}},400)}
 const id=typeof body.stream_id==="string"?body.stream_id:"";const mode=body.mode==="create"?"create":"join";if(!id)return json({ok:false,error:{code:"STREAM_ID_REQUIRED",message:"stream_id is required"}},400);
 const db=createClient(supabaseUrl,supabaseKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:stream,error}=await db.from("live_streams").select("id,user_id,is_live,title").eq("id",id).maybeSingle();
 if(error||!stream)return json({ok:false,error:{code:"STREAM_NOT_FOUND",message:"TV broadcast was not found"}},404);
 if(!stream.is_live)return json({ok:false,error:{code:"STREAM_ENDED",message:"Broadcast is not live"}},409);
 const now=Math.floor(Date.now()/1000);
 if(mode==="create"){
  const auth=req.headers.get("authorization");if(!auth?.startsWith("Bearer "))return json({ok:false,error:{code:"AUTH_REQUIRED",message:"Authentication required"}},401);
  const authDb=createClient(supabaseUrl,supabaseKey,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:ad}=await authDb.auth.getUser();const user=ad?.user??null;
  if(!user||stream.user_id!==user.id)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can invite a guest"}},403);
  const invite=await sign({typ:"tv_guest_invite",role:"guest",stream_id:id,host_id:user.id,jti:crypto.randomUUID(),iat:now,nbf:now,exp:now+900});
  return json({ok:true,data:{invite_token:invite,stream_id:id,expires_at:new Date((now+900)*1000).toISOString()},error:null});
 }
 const invite=typeof body.invite_token==="string"?await verify(body.invite_token):null;
 if(!invite||invite.typ!=="tv_guest_invite"||invite.role!=="guest"||invite.stream_id!==id||typeof invite.host_id!=="string"||invite.host_id!==stream.user_id)return json({ok:false,error:{code:"INVALID_GUEST_INVITE",message:"This guest invitation is invalid or expired"}},401);
 const token=await sign({iss:livekitApiKey,sub:"guest-"+crypto.randomUUID(),name:"Testagram TV Guest",metadata:JSON.stringify({role:"guest",streamId:id}),iat:now,nbf:now,exp:now+3600,video:{roomJoin:true,room:"tv-"+id,canPublish:true,canSubscribe:true,canPublishData:false,canPublishSources:["camera","microphone"]}});
 return json({ok:true,data:{token,url:livekitUrl,room_name:"tv-"+id,stream_id:id,role:"guest"},error:null});
});