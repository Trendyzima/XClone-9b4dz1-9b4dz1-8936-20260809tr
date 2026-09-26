import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const url=Deno.env.get("SUPABASE_URL")!;
const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")!;
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*"}});
 if(req.method!=="GET"&&req.method!=="POST")return Response.json({error:"GET or POST required"},{status:405});
 const u=new URL(req.url); const body=req.method==="POST"?await req.json().catch(()=>({})):{}; const limit=Math.min(Math.max(Number(body.limit??u.searchParams.get("limit")??"8"),1),20), category=body.category??u.searchParams.get("category"), q=body.q??u.searchParams.get("q");
 try{
  let query=db.from("testagram_rss_items").select("id,source_id,profile_id,canonical_url,title,excerpt,author,image_url,category,country_code,language_code,published_at,metadata, testagram_rss_source_profiles!inner(handle,display_name,avatar_url,profile_url)");
  query=query.gt("expires_at",new Date().toISOString()).order("published_at",{ascending:false}).limit(limit);
  if(category)query=query.eq("category",category);
  if(q)query=query.or("title.ilike.%"+q.replace(/[%_]/g,"")+"%,excerpt.ilike.%"+q.replace(/[%_]/g,"")+"%");
  const {data,error}=await query;if(error)throw error;
  return Response.json({items:data||[],count:(data||[]).length},{headers:{"Cache-Control":"public,max-age=60,stale-while-revalidate=300","Access-Control-Allow-Origin":"*"}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:String(e)},{status:500,headers:{"Access-Control-Allow-Origin":"*"}})}
});