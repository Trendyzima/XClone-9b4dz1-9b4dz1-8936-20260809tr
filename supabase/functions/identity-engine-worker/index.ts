import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
const SERVICE_KEY=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";
const ENGINE_SECRET=Deno.env.get("IDENTITY_ENGINE_SECRET")??"";
const admin=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
async function hmacHex(value:string){
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(ENGINE_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value));
 return Array.from(new Uint8Array(sig),b=>b.toString(16).padStart(2,"0")).join("");
}
function safeEqual(a:string,b:string){
 const x=a.toLowerCase(),y=b.toLowerCase();if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x.charCodeAt(i)^y.charCodeAt(i);return d===0;
}
Deno.serve(async req=>{
 if(req.method!=="POST")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
 if(!SERVICE_KEY||!ENGINE_SECRET)return json({ok:false,error:"ENGINE_NOT_CONFIGURED"},503);
 const workerId=req.headers.get("X-Testagram-Engine-Worker")||"";
 const timestamp=req.headers.get("X-Testagram-Engine-Timestamp")||"";
 const nonce=req.headers.get("X-Testagram-Engine-Nonce")||"";
 const raw=await req.text();
 if(!workerId||workerId.length<8||workerId.length>128||!/^[a-f0-9-]+$/i.test(nonce))return json({ok:false,error:"INVALID_ENGINE_IDENTITY"},401);
 const ts=Number(timestamp);if(!Number.isInteger(ts)||Math.abs(Date.now()-ts*1000)>5*60*1000)return json({ok:false,error:"ENGINE_TIMESTAMP_INVALID"},401);
 const supplied=req.headers.get("X-Testagram-Engine-Signature")||"";
 const expected=await hmacHex(timestamp+"."+nonce+"."+raw);
 if(!safeEqual(supplied,"sha256="+expected))return json({ok:false,error:"INVALID_ENGINE_SIGNATURE"},401);
 let body:any={};try{body=JSON.parse(raw||"{}")}catch{return json({ok:false,error:"INVALID_JSON"},400);}
 if(body.action!=="claim")return json({ok:false,error:"UNKNOWN_ACTION"},400);
 const {data,error}=await admin.schema("private").rpc("claim_identity_verification_job",{p_worker_id:workerId});
 if(error)throw error;
 const job=data?.[0]||null;
 if(!job)return json({ok:true,job:null});
 await admin.schema("private").from("identity_verification_jobs").update({state:"processing",updated_at:new Date().toISOString()}).eq("id",job.job_id).eq("state","leased");
 return json({ok:true,job});
});
