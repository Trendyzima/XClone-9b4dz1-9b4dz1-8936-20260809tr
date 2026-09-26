import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Source = { id: string; label: string; url: string; country?: string; priority: number };

const SOURCES: Record<string, Source> = {
  "iptv-org-global": { id:"iptv-org-global", label:"IPTV-ORG · Global public", url:"https://iptv-org.github.io/iptv/index.m3u", country:"INT", priority:135 },
  "iptv-org-news": { id:"iptv-org-news", label:"IPTV-ORG · News", url:"https://iptv-org.github.io/iptv/categories/news.m3u", country:"INT", priority:128 },
  "iptv-org-sports": { id:"iptv-org-sports", label:"IPTV-ORG · Sports", url:"https://iptv-org.github.io/iptv/categories/sports.m3u", country:"INT", priority:127 },
  "iptv-org-music": { id:"iptv-org-music", label:"IPTV-ORG · Music", url:"https://iptv-org.github.io/iptv/categories/music.m3u", country:"INT", priority:126 },
  "free-tv-global": { id:"free-tv-global", label:"Free-TV/IPTV · Global free TV", url:"https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8", country:"INT", priority:130 },
  "free-tv-ke": { id:"free-tv-ke", label:"Free-TV/IPTV · Kenya", url:"https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_kenya.m3u8", country:"KE", priority:129 },
  "iptv-org-ke": { id:"iptv-org-ke", label:"IPTV-ORG · Kenya", url:"https://iptv-org.github.io/iptv/countries/ke.m3u", country:"KE", priority:145 },
  "iptv-org-int": { id:"iptv-org-int", label:"IPTV-ORG · Sub-Saharan Africa", url:"https://iptv-org.github.io/iptv/regions/ssa.m3u", country:"AF", priority:140 },
  "nexus-ke": { id:"nexus-ke", label:"IPTV Nexus · Kenya · health checked", url:NEXUS+"/by-country/ke.json", country:"KE", priority:160 },
  "nexus-news": { id:"nexus-news", label:"IPTV Nexus · News · health checked", url:NEXUS+"/by-category/news.json", country:"INT", priority:156 },
  "nexus-sports": { id:"nexus-sports", label:"IPTV Nexus · Sports · health checked", url:NEXUS+"/by-category/sports.json", country:"INT", priority:155 },
  "nexus-music": { id:"nexus-music", label:"IPTV Nexus · Music · health checked", url:NEXUS+"/by-category/music.json", country:"INT", priority:154 },
  "nexus-kids": { id:"nexus-kids", label:"IPTV Nexus · Kids · health checked", url:NEXUS+"/by-category/kids.json", country:"INT", priority:153 },
  "nexus-entertainment": { id:"nexus-entertainment", label:"IPTV Nexus · Entertainment · health checked", url:NEXUS+"/by-category/entertainment.json", country:"INT", priority:152 },
};

const NEXUS = "https://dearbulut.github.io/iptv/api/v1";
const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"GET,OPTIONS",
  "Cache-Control":"public, max-age=300, s-maxage=1800, stale-while-revalidate=3600",
  "Content-Type":"application/json; charset=utf-8"
};

const blocked = /(adult|porn|xxx|premium|paid subscription|xtream|stalker|pirate)/i;
const clean = (v:string|undefined) => v?.replace(/\s+/g," ").trim() || undefined;
const attr = (line:string,key:string) => line.match(new RegExp(key+'="([^"]*)"',"i"))?.[1]?.trim();

function idFor(name:string,url:string) {
  return btoa(unescape(encodeURIComponent((name+"|"+url).toLowerCase()))).replace(/[^a-z0-9]/gi,"").slice(0,80);
}

function parseM3U(text:string, source:Source, max=300) {
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/);
  const out:any[]=[]; let info:string|null=null;
  for (const raw of lines) {
    if (out.length>=max) break;
    const line=raw.trim(); if(!line) continue;
    if(line.startsWith("#EXTINF")) { info=line; continue; }
    if(line.startsWith("#")) continue;
    if(!info || !/^https?:\/\//i.test(line)) { info=null; continue; }
    const comma=info.indexOf(",");
    const name=clean(comma>=0?info.slice(comma+1):attr(info,"tvg-name"))||"Live TV";
    if(blocked.test(name)) { info=null; continue; }
    const url=line;
    out.push({
      id:idFor(name,url), name, url,
      logo:clean(attr(info,"tvg-logo")),
      group:clean(attr(info,"group-title")),
      country:clean(attr(info,"tvg-country"))||source.country,
      language:clean(attr(info,"tvg-language")),
      source:source.label, priority:source.priority
    });
    info=null;
  }
  return out;
}

async function fetchJson(url:string, signal:AbortSignal) {
  const r=await fetch(url,{signal,headers:{Accept:"application/json","User-Agent":"TestagramTV/3.0"}});
  if(!r.ok) throw new Error("HTTP "+r.status);
  return await r.json();
}

function fromNexus(rows:any[], label:string, priority:number, countryOverride?:string) {
  const out:any[]=[];
  for(const c of rows||[]) {
    if(c?.is_nsfw || !c?.online || blocked.test(c?.name||"")) continue;
    const stream=(c.streams||[]).find((s:any)=>s?.health?.status==="online" && s?.url);
    if(!stream?.url) continue;
    const quality=String(stream.quality||c.best_quality||"");
    out.push({
      id:String(c.id||idFor(c.name,stream.url)),
      name:String(c.name||stream.title||"Live TV"),
      url:String(stream.url),
      logo:c.logo||undefined,
      country:countryOverride||c.country||"INT",
      language:Array.isArray(c.languages)?c.languages[0]:undefined,
      group:Array.isArray(c.categories)?c.categories[0]:undefined,
      source:label,
      priority:priority + (Number.parseInt(quality)||0)/1000
    });
  }
  return out;
}

async function fetchM3U(source:Source, signal:AbortSignal, max=300) {
  const r=await fetch(source.url,{signal,redirect:"follow",headers:{Accept:"application/vnd.apple.mpegurl,text/plain,*/*","User-Agent":"TestagramTV/3.0"}});
  if(!r.ok) throw new Error(source.id+" HTTP "+r.status);
  return parseM3U(await r.text(),source,max);
}

async function githubDiscovery(signal:AbortSignal) {
  const token=Deno.env.get("GITHUB_TOKEN");
  const headers:any={Accept:"application/vnd.github+json","User-Agent":"TestagramTV-GitHub-Discovery"};
  if(token) headers.Authorization="Bearer "+token;
  const search=await fetch("https://api.github.com/search/repositories?q=iptv+m3u+free+in:name,description&sort=stars&order=desc&per_page=8",{signal,headers});
  if(!search.ok) throw new Error("GitHub search HTTP "+search.status);
  const repos=(await search.json()).items||[];
  const safe=repos.filter((r:any)=>r?.public!==false&&!r?.archived&&!r?.fork&&!blocked.test((r.full_name||"")+" "+(r.description||""))).slice(0,6);
  const out:any[]=[];
  await Promise.all(safe.map(async (repo:any)=>{
    try {
      const root=await fetch("https://api.github.com/repos/"+repo.full_name+"/contents",{signal,headers});
      if(!root.ok) return;
      const files=await root.json();
      const playlist=Array.isArray(files)
        ? files.find((f:any)=>f?.type==="file" && /\.(m3u8?|m3u)$/i.test(f.name||"") && (f.size||0)<=2000000)
        : null;
      if(!playlist?.download_url) return;
      const raw=await fetch(playlist.download_url,{signal,headers:{Accept:"text/plain","User-Agent":"TestagramTV-GitHub-Discovery"}});
      if(!raw.ok) return;
      const source={id:"gh-"+repo.id,label:"GitHub · "+repo.full_name,url:playlist.download_url,country:"INT",priority:75};
      out.push(...parseM3U(await raw.text(),source,100));
    } catch {}
  }));
  return out;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  const sourceId=new URL(req.url).searchParams.get("source")||"iptv-org-global";
  const source=SOURCES[sourceId];
  if(!source) return new Response(JSON.stringify({error:"Unknown TV source"}),{status:404,headers:cors});

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try {
    let channels:any[]=[];
    if(sourceId==="iptv-org-global") {
      const [m3u,nexusKe,nexusNews,github]=await Promise.allSettled([
        fetchM3U(source,controller.signal,260),
        fetchJson(NEXUS+"/by-country/ke.json",controller.signal),
        fetchJson(NEXUS+"/by-category/news.json",controller.signal),
        githubDiscovery(controller.signal)
      ]);
      if(m3u.status==="fulfilled") channels.push(...m3u.value);
      if(nexusKe.status==="fulfilled") channels.push(...fromNexus(nexusKe.value,"IPTV Nexus · Kenya · health checked",160,"KE"));
      if(nexusNews.status==="fulfilled") channels.push(...fromNexus(nexusNews.value,"IPTV Nexus · News · health checked",156));
      if(github.status==="fulfilled") channels.push(...github.value);
    } else if(sourceId==="iptv-org-ke") {
      const [m3u,nexus]=await Promise.allSettled([
        fetchM3U(source,controller.signal,180),
        fetchJson(NEXUS+"/by-country/ke.json",controller.signal)
      ]);
      if(nexus.status==="fulfilled") channels.push(...fromNexus(nexus.value,"IPTV Nexus · Kenya · health checked",160,"KE"));
      if(m3u.status==="fulfilled") channels.push(...m3u.value);
    } else if(sourceId==="iptv-org-int") {
      const countries=["za","ng","gh","ug","tz","rw","zm","zw","bw"];
      const rows=await Promise.allSettled(countries.map(c=>fetchJson(NEXUS+"/by-country/"+c+".json",controller.signal)));
      rows.forEach((r,i)=>{if(r.status==="fulfilled") channels.push(...fromNexus(r.value,"IPTV Nexus · "+countries[i].toUpperCase()+" · health checked",150));});
      const m3u=await fetchM3U(source,controller.signal,300).catch(()=>[]);
      channels.push(...m3u);
    } else if (sourceId.startsWith("nexus-")) {
      const endpoint = sourceId === "nexus-ke"
        ? NEXUS+"/by-country/ke.json"
        : NEXUS+"/by-category/"+sourceId.slice("nexus-".length)+".json";
      const rows = await fetchJson(endpoint,controller.signal);
      channels = fromNexus(rows,source.label,source.priority,sourceId === "nexus-ke" ? "KE" : undefined);
    } else {
      channels=await fetchM3U(source,controller.signal,300);
    }

    const seen=new Set<string>();
    channels=channels.filter(c=>{
      const key=String(c.url||"").toLowerCase();
      if(!key||seen.has(key)||blocked.test(c.name||"")) return false;
      seen.add(key); return true;
    }).sort((a,b)=>b.priority-a.priority).slice(0,700);

    return new Response(JSON.stringify({
      source,
      channels,
      meta:{
        generated_at:new Date().toISOString(),
        channel_count:channels.length,
        auto_discovery:sourceId==="iptv-org-global",
        storage:"stream_urls_only"
      }
    }),{headers:cors});
  } catch(error) {
    console.error("[tv-catalog]",sourceId,error);
    return new Response(JSON.stringify({error:"TV source temporarily unavailable",source:sourceId}),{status:502,headers:cors});
  } finally { clearTimeout(timer); }
});