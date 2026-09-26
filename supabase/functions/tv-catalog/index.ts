import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Source = { id:string; label:string; url:string; country?:string; priority:number };

const SOURCES: Record<string,Source> = {
  "iptv-org-global": {id:"iptv-org-global",label:"IPTV-ORG · Global public",url:"https://iptv-org.github.io/iptv/index.m3u",country:"INT",priority:120},
  "iptv-org-news": {id:"iptv-org-news",label:"IPTV-ORG · News",url:"https://iptv-org.github.io/iptv/categories/news.m3u",country:"INT",priority:118},
  "iptv-org-sports": {id:"iptv-org-sports",label:"IPTV-ORG · Sports",url:"https://iptv-org.github.io/iptv/categories/sports.m3u",country:"INT",priority:117},
  "iptv-org-music": {id:"iptv-org-music",label:"IPTV-ORG · Music",url:"https://iptv-org.github.io/iptv/categories/music.m3u",country:"INT",priority:116},
  "free-tv-global": {id:"free-tv-global",label:"Free-TV/IPTV · Global free TV",url:"https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8",country:"INT",priority:110},
  "free-tv-ke": {id:"free-tv-ke",label:"Free-TV/IPTV · Kenya",url:"https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_kenya.m3u8",country:"KE",priority:109},
  "iptv-org-ke": {id:"iptv-org-ke",label:"IPTV.org · Kenya",url:"https://iptv-org.github.io/iptv/countries/ke.m3u",country:"KE",priority:100},
  "iptv-org-int": {id:"iptv-org-int",label:"IPTV.org · International",url:"https://iptv-org.github.io/iptv/regions/ssa.m3u",country:"INT",priority:95},
  "iptv-org-us": {id:"iptv-org-us",label:"IPTV.org · United States",url:"https://iptv-org.github.io/iptv/countries/us.m3u",country:"US",priority:90},
  "iptv-org-gb": {id:"iptv-org-gb",label:"IPTV.org · United Kingdom",url:"https://iptv-org.github.io/iptv/countries/gb.m3u",country:"GB",priority:88},
  "iptv-org-za": {id:"iptv-org-za",label:"IPTV.org · South Africa",url:"https://iptv-org.github.io/iptv/countries/za.m3u",country:"ZA",priority:86},
  "iptv-org-ng": {id:"iptv-org-ng",label:"IPTV.org · Nigeria",url:"https://iptv-org.github.io/iptv/countries/ng.m3u",country:"NG",priority:84},
  "iptv-org-gh": {id:"iptv-org-gh",label:"IPTV.org · Ghana",url:"https://iptv-org.github.io/iptv/countries/gh.m3u",country:"GH",priority:82},
  "fanmingming": {id:"fanmingming",label:"fanmingming/live",url:"https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u",priority:75},
  "iptv-cn": {id:"iptv-cn",label:"IPTV-CN",url:"https://raw.githubusercontent.com/IPTV-CN/IPTV/master/index.m3u",priority:72},
  "yuechan": {id:"yuechan",label:"YueChan/Live",url:"https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u",priority:70},
  "yang": {id:"yang",label:"YanG-1989/m3u",url:"https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u",priority:68},
  "joevess": {id:"joevess",label:"joevess/IPTV",url:"https://raw.githubusercontent.com/joevess/IPTV/main/iptv.m3u8",priority:66},
  "beijing": {id:"beijing",label:"Beijing-IPTV",url:"https://raw.githubusercontent.com/qwerttvv/Beijing-IPTV/master/IPTV-Mobile.m3u",priority:64},
  "free-tv": {id:"free-tv",label:"Free-TV/IPTV",url:"https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8",priority:60},
};

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"GET,OPTIONS",
  "Cache-Control":"public, max-age=120, s-maxage=300",
  "Content-Type":"application/json; charset=utf-8",
};

const clean=(v:string|undefined)=>v?.replace(/\s+/g," ").trim()||undefined;
function attr(line:string,key:string){return line.match(new RegExp(key+'="([^"]*)"',"i"))?.[1]?.trim();}
function parse(text:string,source:Source,max=80){
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/); const out:any[]=[]; let info:string|null=null;
  for(const raw of lines){
    if(out.length>=max) break;
    const line=raw.trim(); if(!line) continue;
    if(line.startsWith("#EXTINF")){info=line;continue;}
    if(line.startsWith("#")) continue;
    if(!info || !/^https?:\/\//i.test(line)){info=null;continue;}
    const comma=info.indexOf(",");
    const name=clean(comma>=0?info.slice(comma+1):attr(info,"tvg-name"))||"Live TV";
    const logo=clean(attr(info,"tvg-logo")); const group=clean(attr(info,"group-title"));
    const country=clean(attr(info,"tvg-country"))||source.country; const language=clean(attr(info,"tvg-language"));
    const id=btoa(unescape(encodeURIComponent(name+"|"+line))).replace(/[^a-z0-9]/gi,"").slice(0,80);
    out.push({id,name,url:line,logo,group,country,language,source:source.label,priority:source.priority});
    info=null;
  }
  return out;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  const sourceId=new URL(req.url).searchParams.get("source")||"iptv-org-ke";
  const source=SOURCES[sourceId];
  if(!source) return new Response(JSON.stringify({error:"Unknown TV source"}),{status:404,headers:cors});
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const upstream=await fetch(source.url,{signal:controller.signal,redirect:"follow",headers:{Accept:"application/vnd.apple.mpegurl,text/plain,*/*","User-Agent":"TestagramTV/2.0"}});
    if(!upstream.ok) throw new Error("source HTTP "+upstream.status);
    const body=await upstream.text();
    const channels=parse(body,source,80);
    return new Response(JSON.stringify({source,channels}),{headers:cors});
  }catch(error){
    console.error("[tv-catalog]",sourceId,error);
    return new Response(JSON.stringify({error:"TV source temporarily unavailable",source:sourceId}),{status:502,headers:cors});
  }finally{clearTimeout(timer);}
});