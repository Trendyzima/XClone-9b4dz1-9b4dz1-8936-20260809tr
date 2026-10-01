export const config={runtime:"edge"};
const env=(n:string,f="")=>{const g=globalThis as any;return g.process?.env?.[n]||f};
const url=(env("SUPABASE_URL",env("VITE_SUPABASE_URL"))).replace(/\/$/,""),key=env("SUPABASE_PUBLISHABLE_KEY",env("SUPABASE_ANON_KEY",env("VITE_SUPABASE_PUBLISHABLE_KEY",env("VITE_SUPABASE_ANON_KEY"))));
const json=(b:unknown,s=200,cacheControl="no-store")=>new Response(JSON.stringify(b),{status:s,headers:{"Content-Type":"application/json","Cache-Control":cacheControl,"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"}});
export default async function handler(req:Request){
 if(req.method==="OPTIONS")return json({ok:true});
 const isGet=req.method==="GET";
 if(!isGet&&req.method!=="POST")return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"POST required."}},405);if(!url||!key)return json({ok:false,error:{code:"SUPABASE_NOT_CONFIGURED",message:"Testagram TV control plane is not configured."}},503);
 let b:any={};
 if(isGet){
  const params=new URL(req.url).searchParams;
  b={action:params.get("action")||"",stream_id:params.get("stream_id")||""};
 }else{
  try{b=await req.json()}catch{return json({ok:false,error:{code:"INVALID_JSON",message:"JSON required."}},400)}
 }
 const action=typeof b?.action==="string"?b.action:"",id=typeof b?.stream_id==="string"?b.stream_id:"";
 if(!["start","viewer","verify","stop","create-guest","guest","guest-control-list","guest-control","heartbeat","youtube-encoder-config"].includes(action))return json({ok:false,error:{code:"ACTION_INVALID",message:"Unsupported TV action."}},400);
 if(isGet&&action!=="viewer")return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"GET is only supported for public viewer lookup."}},405);
 if(!id)return json({ok:false,error:{code:"STREAM_ID_REQUIRED",message:"stream_id is required."}},400);
 const isPublicViewer=action==="viewer";
 const r=await fetch(url+"/functions/v1/tv-media-control",{method:"POST",headers:{"Content-Type":"application/json",apikey:key,...(req.headers.get("authorization")?{Authorization:req.headers.get("authorization")!}:{})},body:JSON.stringify({action,stream_id:id,provider:typeof b?.provider==="string"?b.provider:undefined,invite_token:typeof b?.invite_token==="string"?b.invite_token:undefined,encoder_token:typeof b?.encoder_token==="string"?b.encoder_token:undefined,diagnostics:b?.diagnostics,guest_slot:b?.guest_slot,control:typeof b?.control==="string"?b.control:undefined})});
 const p=await r.json().catch(()=>({ok:false,error:{code:"TV_CONTROL_INVALID_RESPONSE",message:"TV control returned invalid JSON."}}));return json(p,r.status,isPublicViewer&&r.ok?"public, s-maxage=3, stale-while-revalidate=15":"no-store");
}