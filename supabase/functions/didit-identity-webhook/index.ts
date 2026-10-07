import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const DIDIT_API_KEY = Deno.env.get("DIDIT_API_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("DIDIT_WEBHOOK_SECRET") ?? "";
const IDENTITY_SECRET = Deno.env.get("IDENTITY_PREAUTH_SECRET") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false, autoRefreshToken:false } });
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});

function sortKeys(value:any):any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value==="object") return Object.keys(value).sort().reduce((out,key)=>{out[key]=sortKeys(value[key]);return out;},{} as Record<string,unknown>);
  if (typeof value==="number" && !Number.isInteger(value) && value%1===0) return Math.trunc(value);
  return value;
}
async function hmacHex(value:string,secret=WEBHOOK_SECRET){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig),b=>b.toString(16).padStart(2,"0")).join("");
}
function safeEqual(a:string,b:string){
  if(a.length!==b.length)return false;
  let diff=0; for(let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i); return diff===0;
}
async function verifySignature(body:any,timestamp:string){
  if(!WEBHOOK_SECRET) return false;
  const ts=Number(timestamp);
  if(!Number.isFinite(ts)||Math.abs(Math.floor(Date.now()/1000)-ts)>300)return false;
  const signatureV2=body.__signature_v2 as string|undefined;
  if(!signatureV2)return false;
  const clean={...body}; delete clean.__signature_v2;
  const canonical=JSON.stringify(sortKeys(clean));
  return safeEqual(await hmacHex(canonical),signatureV2);
}
async function idHmac(id:string){
  if(!IDENTITY_SECRET) throw new Error("IDENTITY_SECRET_NOT_CONFIGURED");
  return hmacHexWithSecret("id|"+id,IDENTITY_SECRET);
}
async function hmacHexWithSecret(value:string,secret:string){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value));
  return "\\x"+Array.from(new Uint8Array(sig),b=>b.toString(16).padStart(2,"0")).join("");
}
function findWarnings(decision:any):string[]{
  const warnings:string[]=[];
  for(const key of ["id_verifications","liveness_checks","face_matches","ip_analyses"]){
    for(const feature of Array.isArray(decision?.[key])?decision[key]:[]){
      for(const warning of Array.isArray(feature?.warnings)?feature.warnings:[]) if(typeof warning?.risk==="string") warnings.push(warning.risk);
    }
  }
  return warnings;
}
function findId(decision:any){
  const items=Array.isArray(decision?.id_verifications)?decision.id_verifications:[];
  const approved=items.find((x:any)=>x?.status==="Approved") ?? items[0];
  if(!approved)return null;
  const personal=typeof approved.personal_number==="string"?approved.personal_number.replace(/[^A-Za-z0-9]/g,"").toUpperCase():"";
  const document=typeof approved.document_number==="string"?approved.document_number.replace(/[^A-Za-z0-9]/g,"").toUpperCase():"";
  return {
    id: personal || document,
    last4:(personal||document).slice(-4),
    dob:typeof approved.date_of_birth==="string"?approved.date_of_birth:null,
    issuingState:typeof approved.issuing_state==="string"?approved.issuing_state:null,
    documentType:typeof approved.document_type==="string"?approved.document_type:null,
  };
}
async function deleteDiditSession(sessionId:string){
  if(!DIDIT_API_KEY)return;
  await fetch("https://verification.didit.me/v3/session/"+encodeURIComponent(sessionId)+"/delete/",{method:"DELETE",headers:{"x-api-key":DIDIT_API_KEY}}).catch(()=>{});
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  if(!SERVICE_KEY||!IDENTITY_SECRET||!WEBHOOK_SECRET)return json({ok:false,error:"SERVER_NOT_CONFIGURED"},503);
  try{
    const timestamp=req.headers.get("X-Timestamp")||"";
    const signature=req.headers.get("X-Signature-V2")||"";
    const raw=await req.text();
    let payload:any;
    try{payload=JSON.parse(raw);}catch{return json({ok:false,error:"INVALID_JSON"},400);}
    payload.__signature_v2=signature;
    if(!(await verifySignature(payload,timestamp)))return json({ok:false,error:"INVALID_SIGNATURE"},401);
    delete payload.__signature_v2;

    const eventId=String(payload.event_id||"");
    const sessionId=String(payload.session_id||"");
    const status=String(payload.status||"");
    if(!eventId||!sessionId||!status)return json({ok:false,error:"INVALID_EVENT"},400);

    const existingEvent=await admin.from("identity_verification_events").select("id").eq("provider_event_id",eventId).maybeSingle();
    if(existingEvent.data)return json({ok:true,duplicate:true});

    const {data:intent,error:intentError}=await admin.schema("private").from("identity_signup_intents").select("*").eq("didit_session_id",sessionId).maybeSingle();
    if(intentError)throw intentError;
    if(!intent)return json({ok:true,ignored:true});

    const decision=payload.decision??{};
    const warnings=findWarnings(decision);
    const terminal=["Approved","Declined","Expired","Abandoned","Kyc Expired"].includes(status);
    let identityStatus=intent.identity_status;
    let rejectionReason:string|null=null;
    let providerReference=sessionId;
    let fingerprint:string|null=null;
    let last4:string|null=null;
    let verifiedDob:string|null=null;

    if(status==="Approved"){
      const extracted=findId(decision);
      if(!extracted?.id||extracted.issuingState!=="KEN"||!/identity.?card/i.test(extracted.documentType||"")){
        identityStatus="rejected"; rejectionReason="IDENTITY_DATA_MISSING_OR_UNEXPECTED_DOCUMENT";
      } else if(!extracted.dob||extracted.dob!==intent.birth_date||!/^\\d{4}-\\d{2}-\\d{2}$/.test(extracted.dob)){
        identityStatus="rejected"; rejectionReason="BIRTH_DATE_MISMATCH";
      } else if(warnings.includes("POSSIBLE_DUPLICATED_FACE")||warnings.includes("FACE_IN_BLOCKLIST")){
        identityStatus="blocked"; rejectionReason=warnings.find((w)=>w==="POSSIBLE_DUPLICATED_FACE"||w==="FACE_IN_BLOCKLIST")||"DUPLICATE_FACE";
      } else {
        fingerprint=await idHmac(extracted.id);
        last4=extracted.last4;
        verifiedDob=extracted.dob;
        const {error:updateError}=await admin.schema("private").from("identity_signup_intents").update({
          identity_status:"approved",didit_status:status,id_number_hmac:fingerprint,id_number_last4:last4,
          verified_birth_date:verifiedDob,provider_reference:providerReference,rejection_reason:null,updated_at:new Date().toISOString()
        }).eq("id",intent.id);
        if(updateError){
          if(updateError.code==="23505"){
            identityStatus="blocked"; rejectionReason="IDENTITY_ALREADY_REGISTERED";
          }else throw updateError;
        }
      }
    }else if(status==="In Review"){
      identityStatus="under_review";
    }else if(status==="Declined"){
      identityStatus="rejected"; rejectionReason=warnings[0]||"DIDIT_DECLINED";
    }else if(status==="Resubmitted"||status==="In Progress"||status==="Not Started"){
      identityStatus="pending";
    }else if(["Expired","Abandoned"].includes(status)){
      identityStatus="rejected"; rejectionReason="VERIFICATION_SESSION_ENDED";
    }else if(status==="Kyc Expired"){
      identityStatus="rejected"; rejectionReason="KYC_EXPIRED";
    }

    const updatePayload:any={didit_status:status,identity_status:identityStatus,provider_reference:providerReference,rejection_reason:rejectionReason,updated_at:new Date().toISOString()};
    if(fingerprint)Object.assign(updatePayload,{id_number_hmac:fingerprint,id_number_last4:last4,verified_birth_date:verifiedDob});
    const {error:updateError}=await admin.schema("private").from("identity_signup_intents").update(updatePayload).eq("id",intent.id);
    if(updateError)throw updateError;

    if(identityStatus==="approved" && intent.completed_user_id && fingerprint){
      try {
        const now=new Date().toISOString();
        const {error:identityError}=await admin.from("identity_verifications").upsert({
          user_id:intent.completed_user_id,id_type:"ke_national_id",id_number_hmac:fingerprint,
          id_number_last4:last4,country_code:"KE",status:"approved",verification_method:"provider",
          provider:"didit",provider_reference:providerReference,submitted_at:now,reviewed_at:now,
          email_snapshot:intent.email
        },{onConflict:"user_id"});
        if(identityError){
          if(identityError.code==="23505") {
            await admin.schema("private").from("identity_signup_intents").update({identity_status:"blocked",rejection_reason:"IDENTITY_ALREADY_REGISTERED",updated_at:now}).eq("id",intent.id);
            identityStatus="blocked"; rejectionReason="IDENTITY_ALREADY_REGISTERED";
          } else throw identityError;
        } else {
          const {error:profileError}=await admin.from("profiles").update({
            birth_date:verifiedDob,identity_verification_status:"approved",identity_verified_at:now
          }).eq("id",intent.completed_user_id);
          if(profileError)throw profileError;
        }
      } catch(error) {
        console.error("DIDIT_EXISTING_ACCOUNT_UPDATE_FAILED",JSON.stringify({error:error instanceof Error?error.message:"UNKNOWN_ERROR",user_id:intent.completed_user_id}));
        throw error;
      }
    }

    await admin.from("identity_verification_events").insert({
      provider_event_id:eventId,event_type:"DIDIT_"+status.toUpperCase().replace(/\\s+/g,"_"),
      outcome:identityStatus,request_id:eventId,user_id:null,actor_id:null,
      metadata:{session_id:sessionId,status,warnings:warnings.slice(0,20),webhook_type:payload.webhook_type||null}
    });

    if(terminal && !(status==="Approved" && identityStatus==="approved")) await deleteDiditSession(sessionId);
    if(status==="Approved" && identityStatus==="approved") await deleteDiditSession(sessionId);

    return json({ok:true});
  }catch(error){
    const message=error instanceof Error?error.message:"UNKNOWN_ERROR";
    console.error("DIDIT_IDENTITY_WEBHOOK_FAILURE",JSON.stringify({error:message}));
    return json({ok:false,error:"WEBHOOK_PROCESSING_FAILED"},500);
  }
});
