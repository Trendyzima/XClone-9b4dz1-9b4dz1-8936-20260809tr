import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { XMLParser } from "npm:fast-xml-parser@5.3.0";

const url=Deno.env.get("SUPABASE_URL")!;
const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")!;
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@",textNodeName:"#text",removeNSPrefix:true});

const clean=(v:any)=>String(typeof v==="object"&&v!==null?(v["#text"]??v["@url"]??v["@href"]??""):v??"").replace(/<!\[CDATA\[|\]\]>/g,"").trim();
const arr=(v:any)=>Array.isArray(v)?v:(v?[v]:[]);
const pickImage=(item:any)=>{
  const media=arr(item.media?.content??item.content?.["media:content"]??item["media:content"]);
  for(const x of media){const u=clean(x?.["@url"]??x?.url);if(u)return u}
  const thumb=arr(item.media?.thumbnail??item["media:thumbnail"]);for(const x of thumb){const u=clean(x?.["@url"]??x?.url);if(u)return u}
  const enc=arr(item.enclosure);for(const x of enc){const u=clean(x?.["@url"]??x?.url);if(u&&/image\//i.test(clean(x?.["@type"])))return u}
  const html=clean(item.description??item.summary);const m=html.match(/<img[^>]+src=["']([^"']+)/i);return m?.[1]||null;
};
const canonical=(item:any)=>clean(item.link?.["#text"]??item.link?.["@href"]??item.link??item.guid?.["#text"]??item.guid);
const title=(item:any)=>clean(item.title)||"Untitled";
const excerpt=(item:any)=>clean(item.description??item.summary??item.content?.["encoded"]??item.content).replace(/<[^>]+>/g," ").replace(/\s+/g," ").slice(0,700);
const published=(item:any)=>{const raw=clean(item.pubDate??item.published??item.updated??item.dc?.date);const d=new Date(raw);return Number.isFinite(d.getTime())?d.toISOString():new Date().toISOString()};

async function fetchSource(source:any){
 const headers:Record<string,string>={"User-Agent":"Testagram RSS Reader/1.1 (+https://testagram.site)","Accept":"application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.1"};
 if(source.etag)headers["If-None-Match"]=source.etag;
 if(source.last_modified)headers["If-Modified-Since"]=source.last_modified;
 const res=await fetch(source.feed_url,{headers,redirect:"follow"});
 const fetchedAt=new Date().toISOString();
 if(res.status===304){
   await db.from("testagram_rss_sources").update({last_fetched_at:fetchedAt,last_success_at:fetchedAt,last_error:null,consecutive_failures:0,next_fetch_at:new Date(Date.now()+source.refresh_minutes*60*1000).toISOString(),updated_at:fetchedAt}).eq("id",source.id);
   return 0;
 }
 if(!res.ok)throw new Error("HTTP "+res.status);
 const length=Number(res.headers.get("content-length")||"0");
 if(length>2_000_000)throw new Error("Feed exceeds 2 MB safety limit");
 const reader=res.body?.getReader();
 if(!reader)throw new Error("Feed response body unavailable");
 const chunks:Uint8Array[]=[];let total=0;
 while(true){const part=await reader.read();if(part.done)break;total+=part.value?.byteLength||0;if(total>2_000_000){await reader.cancel();throw new Error("Feed exceeds 2 MB safety limit")}if(part.value)chunks.push(part.value)}
 const xml=new TextDecoder().decode(await (async()=>{const merged=new Uint8Array(total);let offset=0;for(const c of chunks){merged.set(c,offset);offset+=c.byteLength}return merged})());
 const nextEtag=res.headers.get("etag")||source.etag||null;
 const nextLastModified=res.headers.get("last-modified")||source.last_modified||null;
 const parsed=parser.parse(xml);
 const channel=parsed.rss?.channel??parsed.feed??parsed["rdf:RDF"]??{};
 const entries=arr(channel.item??channel.entry);
 const rows=[];
 for(const item of entries.slice(0,40)){
   const link=canonical(item); if(!/^https?:\/\//i.test(link))continue;
   const pub=published(item);
   const pubDate=new Date(pub); if(pubDate.getTime()<Date.now()-12*60*60*1000)continue;
   rows.push({source_id:source.id,profile_id:source.profile_id,guid:clean(item.guid?.["#text"]??item.guid) || link,canonical_url:link,title:title(item),excerpt:excerpt(item)||null,author:clean(item.author?.name??item.author??item.dc?.creator)||null,image_url:pickImage(item),category:source.category,country_code:source.country_code,language_code:source.language_code,published_at:pub,fetched_at:fetchedAt,expires_at:new Date(Date.now()+6*60*60*1000).toISOString(),metadata:{source_name:source.source_name}});
 }
 if(rows.length)await db.from("testagram_rss_items").upsert(rows,{onConflict:"source_id,canonical_url",ignoreDuplicates:false});
 await db.from("testagram_rss_sources").update({etag:nextEtag,last_modified:nextLastModified,last_fetched_at:fetchedAt,last_success_at:fetchedAt,last_error:null,consecutive_failures:0,next_fetch_at:new Date(Date.now()+source.refresh_minutes*60*1000).toISOString(),updated_at:fetchedAt}).eq("id",source.id);
 return rows.length;
}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204});
 if(req.method!=="POST"&&req.method!=="GET")return new Response("Method not allowed",{status:405});
 try{
  const limit=Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit")||"12"),1),25);
  const {data:sources,error}=await db.from("testagram_rss_sources").select("id,profile_id,source_name,feed_url,category,country_code,language_code,refresh_minutes,etag,last_modified,consecutive_failures").eq("enabled",true).lte("next_fetch_at",new Date().toISOString()).order("next_fetch_at",{ascending:true}).limit(limit);
  if(error)throw error;
  let ok=0,items=0,failed=0;
  for(const source of sources||[]){try{items+=await fetchSource(source);ok++}catch(e){failed++;await db.from("testagram_rss_sources").update({last_fetched_at:new Date().toISOString(),last_error:e instanceof Error?e.message:String(e),consecutive_failures:Math.min(8,(Number((source as any).consecutive_failures)||0)+1),next_fetch_at:new Date(Date.now()+Math.min(720,Math.pow(2,Math.min(8,(Number((source as any).consecutive_failures)||0)+1))*5)*60*1000).toISOString(),updated_at:new Date().toISOString()}).eq("id",source.id)}}
  const {data:deleted}=await db.rpc("cleanup_testagram_rss_items");
  return Response.json({ok:true,sources_attempted:(sources||[]).length,sources_succeeded:ok,sources_failed:failed,items_upserted:items,items_deleted:Number(deleted||0)});
 }catch(e){console.error("[testagram-rss-ingest]",e);return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500})}
});