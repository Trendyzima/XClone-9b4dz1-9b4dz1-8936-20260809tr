import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const ENGINE_SECRET = Deno.env.get("IDENTITY_ENGINE_SECRET") ?? "";
const IDENTITY_SECRET = Deno.env.get("IDENTITY_PREAUTH_SECRET") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false, autoRefreshToken:false } });

function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});}
async function hmacHex(secret:string,value:string){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig),b=>b.toString(16).padStart(2,"0")).join("");
}
function safeEqual(a:string,b:string){
  const x=a.trim().toLowerCase().replace(/^sha256=/,""),y=b.trim().toLowerCase().replace(/^sha256=/,"");
  if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x.charCodeAt(i)^y.charCodeAt(i);return d===0;
}
function isAdult(date:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const dob=new Date(date+"T00:00:00Z"); if(Number.isNaN(dob.getTime())) return false;
  const cutoff=new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear()-18); return dob<=cutoff;
}
Deno.serve(async req=>{
  if(req.method!=="POST")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  if(!SERVICE_KEY||!ENGINE_SECRET||!IDENTITY_SECRET)return json({ok:false,error:"ENGINE_NOT_CONFIGURED"},503);
  const raw=await req.text();
  const supplied=req.headers.get("X-Testagram-Engine-Signature")||"";
  const expected=await hmacHex(ENGINE_SECRET,raw);
  if(!safeEqual(supplied,"sha256="+expected))return json({ok:false,error:"INVALID_ENGINE_SIGNATURE"},401);
  let body:any;try{body=JSON.parse(raw)}catch{return json({ok:false,error:"INVALID_JSON"},400);}
  const sessionId=String(body?.session_id||"");
  const modelVersion=String(body?.model_version||"");
  const idNumber=String(body?.id_number||"").replace(/\D/g,"");
  const dob=String(body?.date_of_birth||"").trim();
  if(!/^[0-9a-f-]{36}$/i.test(sessionId)||!modelVersion||!/^[0-9]{6,12}$/.test(idNumber)||!/^\d{4}-\d{2}-\d{2}$/.test(dob)){
    return json({ok:false,error:"INVALID_ENGINE_RESULT"},400);
  }
  const score=(v:any)=>typeof v==="number"&&Number.isFinite(v)?v:null;
  const ocr=score(body?.ocr_confidence),live=score(body?.liveness_score),face=score(body?.face_match_score),tamper=score(body?.tamper_score);
  const documentValid=body?.document_valid===true,crossMatch=body?.cross_document_match===true,ageOk=body?.age_ok===true&&isAdult(dob),duplicateOk=body?.duplicate_ok===true;
  if(ocr===null||live===null||face===null||tamper===null)return json({ok:false,error:"ENGINE_SCORES_REQUIRED"},400);
  if([ocr,live,face,tamper].some(v=>v<0||v>1))return json({ok:false,error:"ENGINE_SCORE_RANGE"},400);
  const {data:session,error:sessionError}=await admin.schema("private").from("identity_verification_sessions").select("*").eq("id",sessionId).maybeSingle();
  if(sessionError)throw sessionError;if(!session)return json({ok:false,error:"SESSION_NOT_FOUND"},404);
  if(new Date(session.expires_at).getTime()<Date.now())return json({ok:false,error:"SESSION_EXPIRED"},400);
  if(!["processing","capturing","under_review"].includes(session.state))return json({ok:false,error:"SESSION_NOT_PROCESSING"},409);
  const fingerprint="\\x"+await hmacHex(IDENTITY_SECRET,"ke-nid|"+idNumber);
  const {data:duplicate}=await admin.from("identity_verifications").select("id,user_id").eq("id_number_hmac",fingerprint).maybeSingle();
  const actuallyDuplicate=!!duplicate && duplicate.user_id!==session.user_id;
  const finalDuplicateOk=duplicateOk&&!actuallyDuplicate;
  let decision:"approved"|"rejected"|"manual_review"="manual_review",reason:string|null=null;
  if(actuallyDuplicate||!duplicateOk){decision="rejected";reason="IDENTITY_ALREADY_REGISTERED";}
  else if(!documentValid){decision="rejected";reason="DOCUMENT_INVALID";}
  else if(!ageOk){decision="rejected";reason="AGE_RESTRICTION";}
  else if(!crossMatch){decision="rejected";reason="DOCUMENT_FIELDS_MISMATCH";}
  else if(live<0.80||face<0.80||tamper>0.30||ocr<0.75){decision="rejected";reason="BIOMETRIC_OR_DOCUMENT_QUALITY_FAILED";}
  else if(ocr>=0.90&&live>=0.90&&face>=0.92&&tamper<=0.10&&crossMatch&&ageOk&&finalDuplicateOk){decision="approved";}
  else {decision="manual_review";reason="QUALITY_REVIEW_REQUIRED";}
  const signedAt=new Date().toISOString();
  const {error:resultError}=await admin.schema("private").from("identity_engine_results").upsert({
    session_id:sessionId,model_version:modelVersion,document_valid:documentValid,ocr_confidence:ocr,
    id_number_hmac:fingerprint,id_number_last4:idNumber.slice(-4),verified_birth_date:dob,
    liveness_score:live,face_match_score:face,tamper_score:tamper,cross_document_match:crossMatch,
    age_ok:ageOk,duplicate_ok:finalDuplicateOk,decision,rejection_reason:reason,
    engine_signature:supplied,signed_at:signedAt
  },{onConflict:"session_id"});
  if(resultError)throw resultError;
  const nextState=decision==="approved"?"approved":decision==="rejected"?"rejected":"under_review";
  await admin.schema("private").from("identity_verification_sessions").update({state:nextState,completed_at:decision==="manual_review"?null:signedAt,updated_at:signedAt}).eq("id",sessionId);
  await admin.schema("private").from("identity_signup_intents").update({
    verification_stage:decision,identity_status:decision==="approved"?"approved":decision==="rejected"?"rejected":"under_review",
    id_number_hmac:fingerprint,id_number_last4:idNumber.slice(-4),verified_birth_date:decision==="approved"?dob:null,
    rejection_reason:reason,updated_at:signedAt
  }).eq("id",session.intent_id);
  await admin.from("identity_verification_events").insert({
    user_id:session.user_id||null,event_type:"TESTAGRAM_ENGINE_"+decision.toUpperCase(),outcome:decision,
    provider_event_id:"testagram-engine:"+sessionId+":"+signedAt,request_id:sessionId,
    metadata:{engine:"testagram-native",session_id:sessionId,model_version:modelVersion,ocr_confidence:ocr,liveness_score:live,face_match_score:face,tamper_score:tamper}
  });
  if(decision==="approved"&&session.user_id){
    const {error}=await admin.from("identity_verifications").upsert({
      user_id:session.user_id,id_type:"ke_national_id",id_number_hmac:fingerprint,id_number_last4:idNumber.slice(-4),
      country_code:"KE",status:"approved",verification_method:"self_hosted",provider:null,provider_reference:null,
      submitted_at:signedAt,reviewed_at:signedAt,email_snapshot:null
    },{onConflict:"user_id"});
    if(error)throw error;
    await admin.from("profiles").update({identity_verification_status:"approved",identity_verified_at:signedAt,birth_date:dob}).eq("id",session.user_id);
  }
  return json({ok:true,session_id:sessionId,decision,rejection_reason:reason,engine:"testagram-native",model_version:modelVersion});
});
