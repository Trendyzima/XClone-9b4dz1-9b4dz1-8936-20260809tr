import { mkdir, writeFile } from "node:fs/promises";

const MAX = 100000;
const SOURCES = [
  { id:"iptv-org", name:"IPTV-ORG Global", url:"https://iptv-org.github.io/iptv/index.m3u", priority:100, format:"m3u" },
  { id:"nexus-best", name:"IPTV Nexus · Best healthy public streams", url:"https://dearbulut.github.io/iptv/playlists/best.m3u", priority:99, format:"m3u" },
  { id:"shovo-global", name:"IPTV By Shovo · Global", url:"https://shovo127.github.io/IPTV-By-Shovo/index.m3u", priority:96, format:"m3u" },
  { id:"free-tv", name:"Free-TV/IPTV Global", url:"https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8", priority:90, format:"m3u" },
  { id:"usama-snapshot", name:"UsamaSarwar IPTV · verified channel snapshot", url:"https://raw.githubusercontent.com/UsamaSarwar/iptv/main/public/channels-snapshot.json", priority:88, format:"json" },
  { id:"freecast", name:"FreeCastHub · Global public", url:"https://raw.githubusercontent.com/freecasthub/public-iptv/main/playlist.m3u", priority:84, format:"m3u" },
  { id:"iprtl-pluto", name:"IPRTL · Pluto public streams", url:"https://raw.githubusercontent.com/iprtl/m3u/live/Pluto.m3u", priority:82, format:"m3u" },
  { id:"iprtl-freetv", name:"IPRTL · FreeTV public streams", url:"https://raw.githubusercontent.com/iprtl/m3u/live/Freetv.m3u", priority:81, format:"m3u" },
  { id:"freecast-sports", name:"FreeCastHub · Sports", url:"https://raw.githubusercontent.com/freecasthub/public-iptv/main/sports.m3u", priority:80, format:"m3u" },
  { id:"freecast-news", name:"FreeCastHub · News", url:"https://raw.githubusercontent.com/freecasthub/public-iptv/main/news.m3u", priority:79, format:"m3u" },
  { id:"freecast-education", name:"FreeCastHub · Education", url:"https://raw.githubusercontent.com/freecasthub/public-iptv/main/education.m3u", priority:78, format:"m3u" },
  { id:"freecast-weather", name:"FreeCastHub · Weather", url:"https://raw.githubusercontent.com/freecasthub/public-iptv/main/weather.m3u", priority:77, format:"m3u" },
  { id:"subash-football-cricket", name:"Subash · Football & Cricket public FTA", url:"https://raw.githubusercontent.com/subash9860/iptv-football-cricket/main/index.m3u", priority:75, format:"m3u" }
];

const blocked = /(adult|porn|xxx|premium|paid subscription|xtream|stalker|pirate)/i;
const clean = v => v?.replaceAll("\t"," ").replaceAll("\r"," ").trim() || undefined;
const attr = (line,key) => line.match(new RegExp(key+'="([^"]*)"',"i"))?.[1]?.trim();

function makeId(value) {
  return Buffer.from(String(value).toLowerCase()).toString("base64url").slice(0,80);
}

function parseM3U(text, source) {
  const lines=text.split(/\r?\n/);
  const out=[]; let info=null;
  for(const raw of lines) {
    if(out.length >= MAX) break;
    const line=raw.trim(); if(!line) continue;
    if(line.startsWith("#EXTINF")) { info=line; continue; }
    if(line.startsWith("#")) continue;
    if(!info || !/^https?:\/\//i.test(line)) { info=null; continue; }
    const comma=info.indexOf(",");
    const name=clean(comma>=0 ? info.slice(comma+1) : attr(info,"tvg-name")) || "Live TV";
    const url=line;
    const tvgId=clean(attr(info,"tvg-id"));
    if(blocked.test(name) || blocked.test(url)) { info=null; continue; }
    out.push({
      id: makeId(tvgId || name+"|"+url),
      tvg_id:tvgId,
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

function parseJSON(payload, source) {
  const rows=Array.isArray(payload) ? payload : Array.isArray(payload?.channels) ? payload.channels : [];
  return rows.slice(0,MAX).map(c => ({
    id: makeId(c.id || c.tvg_id || c.name || c.url),
    tvg_id: clean(c.id || c.tvg_id),
    name: clean(c.name) || "Live TV",
    url: String(c.url || "").trim(),
    logo: clean(c.logo),
    group: clean(c.group || c.category),
    country: clean(c.country),
    language: clean(c.language),
    source: source.name,
    source_id: source.id,
    priority: source.priority
  })).filter(c => /^https?:\/\//i.test(c.url) && !blocked.test(c.name) && !blocked.test(c.url));
}

async function fetchSource(source) {
  const response=await fetch(source.url,{
    headers:{
      "User-Agent":"TestagramTV-Catalog/2.0",
      "Accept":source.format==="json" ? "application/json" : "text/plain,application/vnd.apple.mpegurl,*/*"
    }
  });
  if(!response.ok) throw new Error("HTTP "+response.status);
  const text=await response.text();
  return source.format==="json" ? parseJSON(JSON.parse(text),source) : parseM3U(text,source);
}

const all=[];
for(const source of SOURCES) {
  try {
    const rows=await fetchSource(source);
    all.push(...rows);
    console.log(source.id+": "+rows.length);
  } catch(error) {
    console.warn("Skipped "+source.id+": "+error.message);
  }
}

function normalize(value="") {
  return value.toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g," ").trim();
}

function identityKey(channel) {
  const tvg=normalize(channel.tvg_id);
  if(tvg) return "id:"+tvg;
  const name=normalize(channel.name);
  const country=normalize(channel.country || "");
  if(country) return "name:"+name+"|country:"+country;
  return "url:"+channel.url.toLowerCase();
}

const seenUrl=new Set();
const seenIdentity=new Set();
const channels=[];
let duplicateUrls=0;
let duplicateIdentities=0;

for(const channel of all.sort((a,b)=>b.priority-a.priority)) {
  const urlKey=channel.url.toLowerCase().trim();
  if(seenUrl.has(urlKey)) { duplicateUrls++; continue; }
  const identity=identityKey(channel);
  if(seenIdentity.has(identity)) { duplicateIdentities++; continue; }
  seenUrl.add(urlKey);
  seenIdentity.add(identity);
  channels.push({...channel, channel_key:identity});
  if(channels.length>=MAX) break;
}

const countries=[...new Set(channels.map(c=>c.country).filter(Boolean))].sort();
const categories=[...new Set(channels.map(c=>c.group).filter(Boolean))].sort();

await mkdir("public/tv",{recursive:true});
await writeFile("public/tv/channels.json",JSON.stringify({
  version:2,
  generated_at:new Date().toISOString(),
  target_channels:100000,
  max_channels:MAX,
  channel_count:channels.length,
  unique_channel_count:channels.length,
  duplicate_urls_removed:duplicateUrls,
  duplicate_channel_identities_removed:duplicateIdentities,
  countries_count:countries.length,
  categories_count:categories.length,
  policy:"Public/free stream directory only. Testagram stores channel metadata and public stream URLs; it does not copy or host broadcast video.",
  sources:SOURCES.map(({id,name,url,priority,format})=>({id,name,url,priority,format})),
  channels
},null,2)+"\n");
console.log("Testagram TV catalogue: "+channels.length+" unique channels; target capacity "+MAX);
console.log("Removed duplicate URLs: "+duplicateUrls+"; duplicate channel identities: "+duplicateIdentities);
