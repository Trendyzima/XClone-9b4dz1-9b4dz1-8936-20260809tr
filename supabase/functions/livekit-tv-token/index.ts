import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl=Deno.env.get("SUPABASE_URL")??"";
const supabaseKey=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??"";
const livekitUrl=Deno.env.get("LIVEKIT_URL")??"";
const livekitApiKey=Deno.env.get("LIVEKIT_API_KEY")??"";
const livekitApiSecret=Deno.env.get("LIVEKIT_API_SECRET")??"";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"}});
const enc=(v:string|Uint8Array)=>{const b=typeof v==="string"?new TextEncoder().encode(v):v;let s="";for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")};
async function sign(p:Record<string,unknown>){const h=enc(JSON.stringify({alg:"HS256",typ:"JWT"})),b=enc(JSON.stringify(p)),i=`${h}.${b}`;const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(livekitApiSecret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(i)));return `${i}.${enc(sig)}`}
async function verify(t:string){try{const p=t.split(".");if(p.length!==3)return null;const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(livekitApiSecret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);if(!await crypto.subtle.verify("HMAC",k,Uint8Array.from(atob(p[2].replace(/-/g,"+").replace(/_/g,"/")+"===".slice((p[2].length+3)%4)),x=>x.charCodeAt(0)),new TextEncoder().encode(p[0]+"."+p[1])))return null;const x=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p[1].replace(/-/g,"+").replace(/_/g,"/")+"===".slice((p[1].length+3)%4)),x=>x.charCodeAt(0))));return typeof x.exp==="number"&&x.exp>Math.floor(Date.now()/1000)?x:null}catch{return null}}\nDeno.serve(async req=>{
 if(req.method==="OPTIONS")return json({ok:true}); if(req.method!=="POST")return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"POST required"}},405);
 const auth=req.headers.get("authorization");
 if(!supabaseUrl||!supabaseKey||!livekitUrl||!livekitApiKey||!livekitApiSecret)return json({ok:false,error:{code:"LIVEKIT_NOT_CONFIGURED",message:"Live broadcast service is not configured"}},503);
 const db=createClient(supabaseUrl,supabaseKey,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:u}=auth?.startsWith("Bearer ")?await db.auth.getUser():{data:{user:null}};
 let body:any={};try{body=await req.json()}catch{return json({ok:false,error:{code:"INVALID_JSON",message:"JSON required"}},400)}
 const streamId=typeof body.stream_id==="string"?body.stream_id:""; if(!streamId)return json({ok:false,error:{code:"STREAM_ID_REQUIRED",message:"stream_id is required"}},400);
 const {data:stream,error}=await db.from("live_streams").select("id,user_id,is_live,title").eq("id",streamId).maybeSingle();
 if(error||!stream)return json({ok:false,error:{code:"STREAM_NOT_FOUND",message:"TV broadcast was not found"}},404);
 const host=Boolean(u.user&&stream.user_id===u.user.id);
 if(!host&&!stream.is_live)return json({ok:false,error:{code:"STREAM_ENDED",message:"Broadcast is not live"}},409);
 const now=Math.floor(Date.now()/1000);
 const token=await sign({iss:livekitApiKey,sub:u.user?.id??`viewer-${crypto.randomUUID()}`,name:u.user?.user_metadata?.display_name??u.user?.email??"TV Viewer",metadata:JSON.stringify({role:host?"host":"viewer",streamId:stream.id}),iat:now,nbf:now,exp:now+60*60,video:{roomJoin:true,room:`tv-${stream.id}`,canPublish:host,canSubscribe:true,canPublishData:false}});
 return json({ok:true,data:{token,url:livekitUrl,room_name:`tv-${stream.id}`,stream_id:stream.id,role:host?"host":"viewer"},error:null});
});