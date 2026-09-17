import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const livekitUrl = Deno.env.get("LIVEKIT_URL") ?? "";
const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
const encode = (value: string | Uint8Array) => { const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value; let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); };
async function sign(payload: Record<string, unknown>) { const h=encode(JSON.stringify({alg:"HS256",typ:"JWT"})); const b=encode(JSON.stringify(payload)); const input=`${h}.${b}`; const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(livekitApiSecret),{name:"HMAC",hash:"SHA-256"},false,["sign"]); const sig=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(input))); return `${input}.${encode(sig)}`; }
Deno.serve(async req => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"POST required"}},405);
  const authorization=req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ok:false,error:{code:"AUTH_REQUIRED",message:"Bearer authentication required"}},401);
  if (!supabaseUrl || !supabaseKey) return json({ok:false,error:{code:"SUPABASE_CONFIG_MISSING",message:"Supabase configuration is unavailable"}},503);
  if (!livekitUrl || !livekitApiKey || !livekitApiSecret) return json({ok:false,error:{code:"LIVEKIT_NOT_CONFIGURED",message:"LiveKit server credentials are not configured"}},503);
  const db=createClient(supabaseUrl,supabaseKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await db.auth.getUser();
  if (authError || !authData.user) return json({ok:false,error:{code:"AUTH_REQUIRED",message:"Authentication required"}},401);
  let body:{space_id?:unknown}; try { body=await req.json(); } catch { return json({ok:false,error:{code:"INVALID_JSON",message:"Request body must be JSON"}},400); }
  const spaceId=typeof body.space_id === "string" ? body.space_id : "";
  if (!spaceId) return json({ok:false,error:{code:"SPACE_ID_REQUIRED",message:"space_id is required"}},400);
  const {data:cap,error:capError}=await db.rpc("get_audio_space_capability",{p_space_id:spaceId});
  if (capError || !cap?.[0]) return json({ok:false,error:{code:"SPACE_CAPABILITY_DENIED",message:capError?.message??"Audio Space capability denied"}},403);
  const c=cap[0]; const now=Math.floor(Date.now()/1000);
  const token=await sign({iss:livekitApiKey,sub:authData.user.id,name:authData.user.user_metadata?.display_name??authData.user.email??authData.user.id,iat:now,nbf:now,exp:now+15*60,video:{roomJoin:true,room:c.room_name,canPublish:Boolean(c.can_publish),canSubscribe:Boolean(c.can_subscribe),canPublishData:Boolean(c.can_publish_data)}});
  return json({ok:true,data:{token,url:livekitUrl,room_name:c.room_name,space_id:c.space_id,role:c.role,state:c.state,muted:c.muted,capabilities:{can_publish:c.can_publish,can_subscribe:c.can_subscribe,can_publish_data:c.can_publish_data}},error:null});
});
