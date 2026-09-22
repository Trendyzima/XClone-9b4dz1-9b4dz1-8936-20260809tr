import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const SUPABASE_ANON_KEY=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??"";
const ACCOUNT_ID=Deno.env.get("CLOUDFLARE_ACCOUNT_ID")??Deno.env.get("R2_ACCOUNT_ID")??"";
const ACCESS_KEY=Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID")??Deno.env.get("R2_ACCESS_KEY_ID")??"";
const SECRET_KEY=Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY")??Deno.env.get("R2_SECRET_ACCESS_KEY")??"";
const BUCKET=Deno.env.get("CLOUDFLARE_R2_BUCKET")??Deno.env.get("R2_MEDIA_BUCKET")??"";
const PUBLIC_BASE=(Deno.env.get("R2_PUBLIC_BASE_URL")??"").replace(/\/$/,"");
const MAX_BYTES=20*1024*1024;
const BLOCKED=new Set(["application/x-msdownload","application/x-msdos-program","application/x-dosexec"]);
const configured=Boolean(SUPABASE_URL&&SUPABASE_ANON_KEY&&ACCOUNT_ID&&ACCESS_KEY&&SECRET_KEY&&BUCKET&&PUBLIC_BASE);
const r2=configured?new S3Client({region:"auto",endpoint:"https://"+ACCOUNT_ID+".r2.cloudflarestorage.com",credentials:{accessKeyId:ACCESS_KEY,secretAccessKey:SECRET_KEY}}):null;
const cors={...corsHeaders(),"Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
function ext(name:string,mime:string){return name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1]??mime.split("/")[1]?.replace("jpeg","jpg").replace("quicktime","mov")??"bin";}
async function auth(req:Request){
 const authorization=req.headers.get("Authorization")??"";
 const token=authorization.replace(/^Bearer\s+/i,"").trim();
 if(!token)return null;
 const c=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
 return (await c.auth.getUser(token)).data.user??null;
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed",code:"METHOD_NOT_ALLOWED"},405);
 if(!configured||!r2)return json({error:"Media storage is temporarily unavailable",code:"MEDIA_STORAGE_UNAVAILABLE"},503);
 try{
  const user=await auth(req); if(!user)return json({error:"Please sign in again",code:"AUTH_REQUIRED"},401);
  const form=await req.formData();
  const file=form.get("file");
  if(!(file instanceof File))return json({error:"Please choose an image or video",code:"FILE_REQUIRED"},400);
  if(file.size<=0)return json({error:"The selected file is empty",code:"EMPTY_FILE"},400);
  if(file.size>MAX_BYTES)return json({error:"Media must be 20 MiB or smaller",code:"FILE_TOO_LARGE"},413);
  const mime=(file.type||"application/octet-stream").trim().toLowerCase();
  if(!mime.includes("/")||BLOCKED.has(mime))return json({error:"This file type is not supported",code:"INVALID_MEDIA_TYPE"},415);
  const postId=form.get("post_id")?String(form.get("post_id")):null;
  const threadId=form.get("thread_id")?String(form.get("thread_id")):null;
  const admin=createClient(SUPABASE_URL,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??Deno.env.get("SUPABASE_SECRET_KEY")??"",{auth:{persistSession:false,autoRefreshToken:false}});
  if(postId){
   const {data}=await admin.from("posts").select("id,author_id,user_id").eq("id",postId).maybeSingle();
   if(!data||(data.author_id!==user.id&&data.user_id!==user.id))return json({error:"Post not found or not owned by you",code:"POST_NOT_OWNED"},404);
  }
  const mediaType=mime.startsWith("image/")?"image":mime.startsWith("video/")?"video":mime.startsWith("audio/")?"audio":"file";
  const key="users/"+user.id+"/"+crypto.randomUUID()+"."+ext(file.name,mime);
  const bytes=new Uint8Array(await file.arrayBuffer());
  await r2.send(new PutObjectCommand({Bucket:BUCKET,Key:key,Body:bytes,ContentType:mime,ContentLength:bytes.byteLength,CacheControl:"public, max-age=31536000, immutable",Metadata:{ownerId:user.id,postMedia:"true"}}));
  const publicUrl=PUBLIC_BASE+"/"+key;
  const {data,error}=await admin.from("media_assets").insert({owner_id:user.id,post_id:postId,thread_id:threadId,storage_key:key,bucket:BUCKET,original_name:file.name,mime_type:mime,media_type:mediaType,byte_size:file.size,status:"uploaded",media_url:publicUrl}).select("id,storage_key,post_id,thread_id,media_url,media_type,mime_type,byte_size,status").single();
  if(error){
   console.error("media_assets insert failed",error);
   return json({error:"Media uploaded but could not be registered",code:"MEDIA_RECORD_FAILED"},500);
  }
  return json({ok:true,media_id:data.id,object_key:data.storage_key,public_url:data.media_url,size_bytes:data.byte_size,mime_type:data.mime_type,media_type:data.media_type,status:data.status},200);
 }catch(error){
  console.error("post-media-upload",error);
  return json({error:"Media upload failed. Please try again.",code:"MEDIA_UPLOAD_FAILED"},500);
 }
});