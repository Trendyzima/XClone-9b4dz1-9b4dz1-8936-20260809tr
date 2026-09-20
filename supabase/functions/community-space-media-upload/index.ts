import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const ACCOUNT_ID = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? Deno.env.get("R2_ACCOUNT_ID") ?? "";
const ACCESS_KEY = Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID") ?? Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
const SECRET_KEY = Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY") ?? Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
const BUCKET = Deno.env.get("CLOUDFLARE_R2_BUCKET") ?? Deno.env.get("R2_MEDIA_BUCKET") ?? "";
const PUBLIC_BASE = (Deno.env.get("R2_PUBLIC_BASE_URL") ?? "").replace(/\/$/, "");
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg","image/png","image/webp","image/gif","image/avif"]);
const cors = { ...corsHeaders, "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"} });
const r2 = ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET ? new S3Client({
  region:"auto", endpoint:`https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials:{accessKeyId:ACCESS_KEY,secretAccessKey:SECRET_KEY}
}) : null;
const admin = SERVICE_ROLE ? createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}}) : null;

async function authUser(req:Request){
  const auth=req.headers.get("Authorization") ?? "";
  const token=auth.replace(/^Bearer\s+/i,"");
  if(!token || !SUPABASE_URL || !ANON_KEY) return null;
  const client=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user}}=await client.auth.getUser(token);
  return user ?? null;
}
function ext(mime:string){return mime==="image/jpeg"?"jpg":mime==="image/png"?"png":mime==="image/webp"?"webp":mime==="image/avif"?"avif":"gif";}
async function detected(file:File){
  const b=new Uint8Array(await file.slice(0,32).arrayBuffer());
  if(b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255)return"image/jpeg";
  if(b.length>=8&&b.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i]))return"image/png";
  if(b.length>=6){const h=new TextDecoder().decode(b.slice(0,6));if(h==="GIF87a"||h==="GIF89a")return"image/gif";}
  if(b.length>=12&&new TextDecoder().decode(b.slice(0,4))==="RIFF"&&new TextDecoder().decode(b.slice(8,12))==="WEBP")return"image/webp";
  if(b.length>=12&&new TextDecoder().decode(b.slice(4,8))==="ftyp"){const brand=new TextDecoder().decode(b.slice(8,12));if(brand==="avif"||brand==="avis")return"image/avif";}
  return null;
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  if(!r2||!admin||!PUBLIC_BASE)return json({error:"Community media storage is not configured",code:"R2_NOT_CONFIGURED"},503);
  try{
    const user=await authUser(req);
    if(!user)return json({error:"Authentication required",code:"AUTH_REQUIRED"},401);
    const form=await req.formData();
    const entity=String(form.get("entity")??"");
    const kind=String(form.get("kind")??"");
    const entityId=String(form.get("entity_id")??"");
    const file=form.get("file");
    if(entity!=="community"||!["icon","banner"].includes(kind)||!entityId||!(file instanceof File))return json({error:"Invalid community media request"},400);
    if(file.size<=0||file.size>MAX_BYTES)return json({error:"Community images must be 5MB or smaller"},413);
    const declared=file.type.toLowerCase(), actual=await detected(file), mime=ALLOWED.has(declared)?declared:actual;
    if(!mime||!ALLOWED.has(mime))return json({error:"Unsupported or invalid image type"},415);
    if(actual&&actual!==mime)return json({error:"Image content does not match declared type"},415);

    const {data:community,error:lookup}=await admin.from("communities").select("id,created_by,owner_id").eq("id",entityId).maybeSingle();
    if(lookup||!community)return json({error:"Community not found"},404);
    if(community.created_by!==user.id&&community.owner_id!==user.id)return json({error:"Community owner access required"},403);

    const key=`communities/${entityId}/${kind}.${ext(mime)}`;
    const bytes=new Uint8Array(await file.arrayBuffer());
    await r2.send(new PutObjectCommand({Bucket:BUCKET,Key:key,Body:bytes,ContentType:mime,ContentLength:bytes.byteLength,CacheControl:"public, max-age=31536000, immutable",Metadata:{ownerId:user.id,entityId,entity:"community",kind}}));
    const url=`${PUBLIC_BASE}/${key}?v=${Date.now()}`;
    const patch=kind==="icon"?{icon_url:url,updated_at:new Date().toISOString()}:{banner_url:url,updated_at:new Date().toISOString()};
    const {error:updateError}=await admin.from("communities").update(patch).eq("id",entityId);
    if(updateError)return json({error:"Community media was uploaded but could not be saved"},500);
    return json({ok:true,delivery_url:url,object_key:key,kind,entity_id:entityId,size_bytes:bytes.byteLength,mime_type:mime});
  }catch(error){console.error("community-space-media-upload",error);return json({error:"Community media operation failed"},500);}
});