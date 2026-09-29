export const config = { runtime: "edge" };

const env=(name:string,fallback="")=>{const g=globalThis as {process?:{env?:Record<string,string|undefined>}};return g.process?.env?.[name]||fallback;};
const supabaseUrl=(env("SUPABASE_URL",env("VITE_SUPABASE_URL"))).replace(/\/$/,"");
const supabaseKey=env("SUPABASE_PUBLISHABLE_KEY",env("SUPABASE_ANON_KEY",env("VITE_SUPABASE_PUBLISHABLE_KEY",env("VITE_SUPABASE_ANON_KEY"))));

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{
    "Content-Type":"application/json",
    "Cache-Control":"no-store",
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Headers":"authorization, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
  },
});

export default async function handler(request:Request){
  if(request.method==="OPTIONS")return json({ok:true});
  if(request.method!=="POST")return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"POST required."}},405);
  if(!supabaseUrl||!supabaseKey)return json({ok:false,error:{code:"SUPABASE_NOT_CONFIGURED",message:"Testagram TV control plane is not configured."}},503);

  let body:any;
  try{body=await request.json();}catch{return json({ok:false,error:{code:"INVALID_JSON",message:"JSON required."}},400);}
  const action=typeof body?.action==="string"?body.action:"";
  const streamId=typeof body?.stream_id==="string"?body.stream_id:"";
  if(!["start","viewer","verify","stop","create-guest","guest","heartbeat"].includes(action))return json({ok:false,error:{code:"ACTION_INVALID",message:"Unsupported TV action."}},400);
  if(!streamId)return json({ok:false,error:{code:"STREAM_ID_REQUIRED",message:"stream_id is required."}},400);

  const upstream=await fetch(`${supabaseUrl}/functions/v1/tv-media-control`,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      apikey:supabaseKey,
      ...(request.headers.get("authorization")?{Authorization:request.headers.get("authorization")!}:{}),
    },
    body:JSON.stringify({
      action,
      stream_id:streamId,
      invite_token:typeof body?.invite_token==="string"?body.invite_token:undefined,
      diagnostics:body?.diagnostics,
    }),
  });

  const payload=await upstream.json().catch(()=>({ok:false,error:{code:"TV_CONTROL_INVALID_RESPONSE",message:"TV control returned invalid JSON."}}));
  return json(payload,upstream.status);
}
