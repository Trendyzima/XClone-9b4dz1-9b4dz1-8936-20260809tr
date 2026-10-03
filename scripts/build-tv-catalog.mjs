import { mkdir, writeFile } from "node:fs/promises";

const MAX = 20000;
const SOURCES = [
  { id:"iptv-org", name:"IPTV-ORG Global", url:"https://iptv-org.github.io/iptv/index.m3u", priority:100 },
  { id:"free-tv", name:"Free-TV/IPTV Global", url:"https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8", priority:90 },
  { id:"freeview-my", name:"Freeview IPTV Malaysia", url:"https://freeview.github.io/iptv/playlist/my.m3u", priority:80 },
  { id:"freeview-sg", name:"Freeview IPTV Singapore", url:"https://freeview.github.io/iptv/playlist/sg.m3u", priority:80 }
];

const blocked = /(adult|porn|xxx|premium|paid subscription|xtream|stalker|pirate)/i;
const clean = v => v?.replaceAll("\t"," ").replaceAll("\r"," ").trim() || undefined;
const attr = (line,key) => line.match(new RegExp(key+'="([^"]*)"',"i"))?.[1]?.trim();

function parse(text, source) {
  const lines=text.split(/\r?\n/);
  const out=[]; let info=null;
  for(const raw of lines) {
    if(out.length >= MAX) break;
    const line=raw.trim(); if(!line) continue;
    if(line.startsWith("#EXTINF")) { info=line; continue; }
    if(line.startsWith("#")) continue;
    if(!info || !(line.startsWith("http://") || line.startsWith("https://"))) { info=null; continue; }
    const comma=info.indexOf(",");
    const name=clean(comma>=0 ? info.slice(comma+1) : attr(info,"tvg-name")) || "Live TV";
    const url=line;
    if(blocked.test(name) || blocked.test(url)) { info=null; continue; }
    out.push({
      id: Buffer.from((name+"|"+url).toLowerCase()).toString("base64url").slice(0,80),
      name, url,
      logo:clean(attr(info,"tvg-logo")),
      group:clean(attr(info,"group-title")),
      country:clean(attr(info,"tvg-country")),
      language:clean(attr(info,"tvg-language")),
      source:source.name,
      source_id:source.id,
      priority:source.priority
    });
    info=null;
  }
  return out;
}

const all=[];
for(const source of SOURCES) {
  try {
    const response=await fetch(source.url,{headers:{"User-Agent":"TestagramTV-Catalog/1.0","Accept":"text/plain,application/vnd.apple.mpegurl,*/*"}});
    if(!response.ok) throw new Error("HTTP "+response.status);
    const rows=parse(await response.text(),source);
    all.push(...rows);
    console.log(source.id+": "+rows.length);
  } catch(error) {
    console.warn("Skipped "+source.id+": "+error.message);
  }
}

const seen=new Set();
const channels=all.filter(c=>{
  const key=c.url.toLowerCase();
  if(seen.has(key)) return false;
  seen.add(key); return true;
}).sort((a,b)=>b.priority-a.priority).slice(0,MAX);

await mkdir("public/tv",{recursive:true});
await writeFile("public/tv/channels.json",JSON.stringify({
  version:1,
  generated_at:new Date().toISOString(),
  max_channels:MAX,
  channel_count:channels.length,
  policy:"Public/free stream directory only. Testagram stores channel metadata and stream URLs; it does not copy broadcast video.",
  sources:SOURCES.map(({id,name,url})=>({id,name,url})),
  channels
},null,2)+"\n");
console.log("Testagram TV catalogue: "+channels.length+" unique channels");
