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
 const media=arr(item.media?.content??item.media?.group?.content??item["media:content"]??item.content?.["media:content"]);
 for(const x of media){const u=clean(x?.["@url"]??x?.url);if(u&&/^https?:\/\//i.test(u))return u}
 const thumb=arr(item.media?.thumbnail??item["media:thumbnail"]);for(const x of thumb){const u=clean(x?.["@url"]??x?.url);if(u&&/^https?:\/\//i.test(u))return u}
 const enc=arr(item.enclosure??item.link);for(const x of enc){const u=clean(x?.["@url"]??x?.["@href"]??x?.url??x?.href);const type=clean(x?.["@type"]??x?.["@rel"]);if(u&&/^https?:\/\//i.test(u)&&(/image\//i.test(type)||String(x?.["@rel"]||"").toLowerCase()==="enclosure"))return u}
 const bodies=[item.description,item.summary,item.content?.encoded,item.content?.["#text"],item["content:encoded"]].map(clean).filter(Boolean);
 for(const html of bodies){const m=html.match(/<img\b[^>]*(?:src|data-src)=["']([^"']+)/i);if(m?.[1]){const u=m[1].replace(/&amp;/g,"&");if(/^https?:\/\//i.test(u))return u}}
 return null;
};
const trustedPublisher=(value:string)=>{
 try{const u=new URL(value);if(u.protocol!=="https:"&&u.protocol!=="http:")return false;const h=u.hostname.toLowerCase();return ["bbc.co.uk","bbc.com","standardmedia.co.ke"].some(base=>h===base||h.endsWith("."+base))&&!u.username&&!u.password}catch{return false}
};
const metaImage=(html:string,pageUrl:string)=>{
 const tags=html.match(/<meta\b[^>]*>/gi)||[];
 for(const tag of tags){
  if(!/(?:property|name)\s*=\s*["'](?:og:image(?::url)?|twitter:image(?::src)?)["']/i.test(tag))continue;
  const match=tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);if(!match?.[1])continue;
  const raw=match[1].replace(/&amp;/g,"&").replace(/&#038;/g,"&").replace(/&quot;/g,'"');
  try{const image=new URL(raw,pageUrl);if((image.protocol==="https:"||image.protocol==="http:")&&!image.username&&!image.password&&image.href.length<=2048)return image.href}catch{}
 }
 return null;
};
async function fetchArticleImage(pageUrl:string):Promise<string|null>{
 if(!trustedPublisher(pageUrl))return null;
 let current=new URL(pageUrl);
 try{
  for(let hop=0;hop<3;hop++){
   if(!trustedPublisher(current.href))return null;
   const res=await fetch(current.href,{headers:{"User-Agent":"Testagram RSS Image Resolver/1.0 (+https://testagram.site)","Accept":"text/html,application/xhtml+xml;q=0.9"},redirect:"manual",signal:AbortSignal.timeout(2500)});
   if(res.status>=300&&res.status<400){
    const location=res.headers.get("location");if(!location)return null;
    current=new URL(location,current);continue;
   }
   if(!res.ok||!/^text\/html\b/i.test(res.headers.get("content-type")||""))return null;
   const reader=res.body?.getReader();if(!reader)return null;
   const chunks:Uint8Array[]=[];let total=0;
   while(total<262144){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>262144){await reader.cancel();return null}chunks.push(part.value)}
   const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
   return metaImage(new TextDecoder().decode(bytes),current.href);
  }
 }catch{return null}
 return null;
}

// Backfill older feed rows on conditional (304) responses too. Without this,
// stories ingested before image enrichment—or whose publisher added OG metadata
// later—would remain permanently image-less because the feed never changed.
async function backfillMissingImages(sourceId:string, limit=3):Promise<number>{
 const {data,error}=await db.from("testagram_rss_items")
  .select("id,canonical_url")
  .eq("source_id",sourceId)
  .is("image_url",null)
  .gt("expires_at",new Date().toISOString())
  .order("published_at",{ascending:false})
  .limit(Math.max(0,Math.min(6,limit)));
 if(error)throw error;
 const candidates=(data||[]).filter((row:any)=>trustedPublisher(String(row.canonical_url||"")));
 let updated=0;
 for(let i=0;i<candidates.length;i+=3){
  const batch=candidates.slice(i,i+3);
  const resolved=await Promise.all(batch.map(async(row:any)=>({id:row.id,image:await fetchArticleImage(row.canonical_url)})));
  for(const item of resolved){
   if(!item.image)continue;
   const {error:updateError}=await db.from("testagram_rss_items").update({image_url:item.image}).eq("id",item.id).is("image_url",null);
   if(updateError)console.error("[testagram-rss-ingest] image backfill update failed",{id:item.id,error:updateError.message});
   else updated++;
  }
 }
 return updated;
}
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
   // A fresh feed does not mean its cached story images are complete. Resolve a
   // small bounded batch of missing thumbnails without refetching the feed.
   try{await backfillMissingImages(source.id,3)}catch(error){console.error("[testagram-rss-ingest] image backfill failed",{source:source.source_name,error:error instanceof Error?error.message:String(error)})}
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
   rows.push({source_id:source.id,profile_id:source.profile_id,guid:clean(item.guid?.["#text"]??item.guid) || link,canonical_url:link,title:title(item),excerpt:excerpt(item)||null,author:clean(item.author?.name??item.author??item.dc?.creator)||null,image_url:pickImage(item),category:source.category,country_code:source.country_code,language_code:source.language_code,published_at:pub,fetched_at:fetchedAt,expires_at:new Date(Date.now()+(source.category==="sports"?3:6)*60*60*1000).toISOString(),metadata:{source_name:source.source_name}});
 }
 // Feeds often omit media tags. Enrich a small, bounded batch from publisher
 // Open Graph metadata so the UI has real editorial images without scraping every story.
 const missingImages=rows.filter(row=>!row.image_url&&trustedPublisher(row.canonical_url)).slice(0,6);
 for(let i=0;i<missingImages.length;i+=3){
  const batch=missingImages.slice(i,i+3);
  const resolved=await Promise.all(batch.map(async row=>({url:row.canonical_url,image:await fetchArticleImage(row.canonical_url)})));
  const byUrl=new Map<string,string>();for(const item of resolved){if(item.image)byUrl.set(item.url,item.image)}
  for(const row of rows){const image=byUrl.get(row.canonical_url);if(image&&!row.image_url)row.image_url=image}
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