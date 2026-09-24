import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"GET,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"private,max-age=0,must-revalidate"}});
async function userId(req:Request){const a=req.headers.get("authorization")||"";if(!/^Bearer\s+/i.test(a))return null;const c=createClient(URL_,ANON,{global:{headers:{Authorization:a}},auth:{persistSession:false,autoRefreshToken:false}});const {data}=await c.auth.getUser(a.replace(/^Bearer\s+/i,"").trim());return data.user?.id??null}
function limit(v:string|null){const n=Number.parseInt(v||"6",10);return Math.min(Math.max(Number.isFinite(n)?n:6,1),12)}
function score(row:any,now:number){
  const published=Date.parse(row.published_at||row.updated_at||"");
  const age=Math.max(0,(now-(Number.isFinite(published)?published:now))/36e5);
  const engagement=Number(row.like_count||0)+Number(row.announce_count||0)*2+Number(row.reply_count||0)*3+Number(row.quote_count||0)*2+Number(row.view_count||0)*0.02;
  const freshness=Math.exp(-age/48);
  const trend=Math.log1p(Math.max(0,engagement))*2.5*freshness;
  return trend+freshness*2+(Math.random()*0.35);
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 if(req.method!=="GET")return json({error:"GET required"},405);
 const uid=await userId(req); if(!uid)return json({error:"Authentication required"},401);
 try{
  const u=new URL(req.url), n=limit(u.searchParams.get("limit")), surface=u.searchParams.get("surface")||"home";
  const rel=await admin.from("federated_follow_relationships").select("remote_actor_uri").eq("local_user_id",uid).in("state",["pending","accepted","active"]);
  if(rel.error)throw rel.error;
  const followed=new Set((rel.data||[]).map((r:any)=>String(r.remote_actor_uri||"")).filter(Boolean));
  const seen=await admin.from("federated_discovery_impressions").select("object_id").eq("user_id",uid).eq("surface",surface).order("shown_at",{ascending:false}).limit(200);
  if(seen.error)throw seen.error;
  const seenIds=new Set((seen.data||[]).map((r:any)=>String(r.object_id)));
  const q=await admin.from("federated_objects").select("id,uri,object_type,actor_uri,instance_id,url,content,summary,published_at,updated_at,sensitive,in_reply_to_uri,quote_uri,language_code,attachments,tags,like_count,announce_count,reply_count,quote_count,view_count,content_warning,raw_object").is("deleted_at",null).eq("tombstone",false).in("object_type",["Note","Article","Question","Video","Image"]).order("published_at",{ascending:false,nullsFirst:false}).limit(250);
  if(q.error)throw q.error;
  const now=Date.now();
  const candidates=(q.data||[]).filter((r:any)=>r.actor_uri&&!followed.has(String(r.actor_uri))&&!seenIds.has(String(r.id))&&!r.sensitive&&!r.content_warning).map((r:any)=>({...r,_score:score(r,now)})).sort((a:any,b:any)=>b._score-a._score);
  const chosen:any[]=[];const actors=new Set<string>();const domains=new Set<string>();
  for(const r of candidates){let domain="";try{domain=new URL(String(r.actor_uri)).hostname}catch{};if(chosen.length&&actors.has(String(r.actor_uri))&&chosen.length<Math.min(n,3))continue;if(domains.has(domain)&&chosen.length>=Math.ceil(n/2))continue;chosen.push(r);actors.add(String(r.actor_uri));if(domain)domains.add(domain);if(chosen.length>=n)break}
  const ids=chosen.map(r=>r.id);if(ids.length){const rows=ids.map(id=>({user_id:uid,object_id:id,surface}));await admin.from("federated_discovery_impressions").upsert(rows,{onConflict:"user_id,object_id,surface",ignoreDuplicates:true})}
  return json({items:chosen.map(({_score,...r})=>({...r,feed_source:"federated_discovery"})),nextCursor:null});
 }catch(e){console.error("[federated-discovery-feed]",e);return json({error:e instanceof Error?e.message:"Discovery feed failed"},500)}
});