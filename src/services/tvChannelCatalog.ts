import {supabaseUrl, supabaseSecondary} from '@/lib/supabase';

export type TvChannel = { id:string; tvg_id?:string; name:string; url:string; logo?:string; country?:string; language?:string; group?:string; source:string; priority:number; live?:boolean; live_checked_at?:string };
export type TvSource = { id:string; label:string; url:string; country?:string; priority:number; enabled?:boolean; policy?:'public-free'|'community-unverified' };
export const TV_SOURCES: TvSource[] = [
{id:'world-ip-tv-verified',label:'World IPTV Checker · daily verified public streams',url:'https://romaxa55.github.io/world_ip_tv/output/index.m3u',country:'INT',priority:170,enabled:true,policy:'public-free'},
{id:'nexus-best',label:'IPTV Nexus · Best healthy public streams',url:'https://dearbulut.github.io/iptv/playlists/best.m3u',country:'INT',priority:169,enabled:true,policy:'public-free'},
{id:'shovo-global',label:'IPTV By Shovo · Global public streams',url:'https://shovo127.github.io/IPTV-By-Shovo/index.m3u',country:'INT',priority:168,enabled:true,policy:'public-free'},
{id:'usama-snapshot',label:'UsamaSarwar IPTV · verified snapshot',url:'https://raw.githubusercontent.com/UsamaSarwar/iptv/main/public/channels-snapshot.json',country:'INT',priority:167,enabled:true,policy:'public-free'},
{id:'nexus-ke',label:'IPTV Nexus · Kenya · health checked',url:'https://dearbulut.github.io/iptv/api/v1/by-country/ke.json',country:'KE',priority:160,enabled:true,policy:'public-free'},
{id:'nexus-news',label:'IPTV Nexus · News · health checked',url:'https://dearbulut.github.io/iptv/api/v1/by-category/news.json',country:'INT',priority:156,enabled:true,policy:'public-free'},
{id:'nexus-sports',label:'IPTV Nexus · Sports · health checked',url:'https://dearbulut.github.io/iptv/api/v1/by-category/sports.json',country:'INT',priority:155,enabled:true,policy:'public-free'},
{id:'nexus-music',label:'IPTV Nexus · Music · health checked',url:'https://dearbulut.github.io/iptv/api/v1/by-category/music.json',country:'INT',priority:154,enabled:true,policy:'public-free'},
{id:'nexus-kids',label:'IPTV Nexus · Kids · health checked',url:'https://dearbulut.github.io/iptv/api/v1/by-category/kids.json',country:'INT',priority:153,enabled:true,policy:'public-free'},
{id:'nexus-entertainment',label:'IPTV Nexus · Entertainment · health checked',url:'https://dearbulut.github.io/iptv/api/v1/by-category/entertainment.json',country:'INT',priority:152,enabled:true,policy:'public-free'},
{id:'iptv-org-ke',label:'IPTV-ORG · Kenya',url:'https://iptv-org.github.io/iptv/countries/ke.m3u',country:'KE',priority:145,enabled:true,policy:'public-free'},
{id:'iptv-org-int',label:'IPTV-ORG · Sub-Saharan Africa',url:'https://iptv-org.github.io/iptv/regions/ssa.m3u',country:'AF',priority:140,enabled:true,policy:'public-free'},
{id:'iptv-org-global',label:'IPTV-ORG · Global public',url:'https://iptv-org.github.io/iptv/index.m3u',country:'INT',priority:135,enabled:true,policy:'public-free'},
{id:'free-tv-global',label:'Free-TV/IPTV · Global free TV',url:'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',country:'INT',priority:130,enabled:true,policy:'public-free'},
{id:'free-tv-ke',label:'Free-TV/IPTV · Kenya',url:'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_kenya.m3u8',country:'KE',priority:129,enabled:true,policy:'public-free'},
{id:'iptv-org-news',label:'IPTV-ORG · News',url:'https://iptv-org.github.io/iptv/categories/news.m3u',country:'INT',priority:128,enabled:true,policy:'public-free'},
{id:'iptv-org-sports',label:'IPTV-ORG · Sports',url:'https://iptv-org.github.io/iptv/categories/sports.m3u',country:'INT',priority:127,enabled:true,policy:'public-free'},
{id:'iptv-org-music',label:'IPTV-ORG · Music',url:'https://iptv-org.github.io/iptv/categories/music.m3u',country:'INT',priority:126,enabled:true,policy:'public-free'},
{id:'iprtl-freetv',label:'IPRTL · FreeTV · public streams',url:'https://raw.githubusercontent.com/iprtl/m3u/live/Freetv.m3u',country:'INT',priority:119,enabled:true,policy:'community-unverified'},
{id:'iprtl-pluto',label:'IPRTL · Pluto · public streams',url:'https://raw.githubusercontent.com/iprtl/m3u/live/Pluto.m3u',country:'INT',priority:118,enabled:true,policy:'community-unverified'},
{id:'subash-football-cricket',label:'Subash · Football & Cricket · public FTA',url:'https://raw.githubusercontent.com/subash9860/iptv-football-cricket/main/index.m3u',country:'INT',priority:117,enabled:true,policy:'community-unverified'},
{id:'dhanytv-indonesia',label:'dhanytv · Indonesia public channels',url:'https://raw.githubusercontent.com/dhasap/dhanytv/main/dhanytv-ott.m3u',country:'ID',priority:116,enabled:true,policy:'public-free'},
{id:'blitz-latam',label:'Blitz IPTV Player · public channel snapshot',url:'https://raw.githubusercontent.com/blitzandres/iptv-player/main/channels.json',country:'INT',priority:115,enabled:true,policy:'community-unverified'},
{id:'freecast-global',label:'FreeCastHub · Global public broadcasters',url:'https://raw.githubusercontent.com/freecasthub/public-iptv/main/playlist.m3u',country:'INT',priority:114,enabled:true,policy:'public-free'},
{id:'india-active-community',label:'India · community active-stream playlist',url:'https://raw.githubusercontent.com/gnaidu05/iptv/main/playlists/india-active.m3u',country:'IN',priority:113,enabled:true,policy:'community-unverified'},
{id:'portugal-free-tv',label:'Portugal · Portuguese-language free TV',url:'https://raw.githubusercontent.com/cesarsferreira/m3u/main/tv.m3u',country:'PT',priority:112,enabled:true,policy:'public-free'},
{id:'indonesia-community',label:'Indonesia · community public TV playlist',url:'https://raw.githubusercontent.com/riotryulianto/iptv-playlists/main/playlist.m3u',country:'ID',priority:111,enabled:true,policy:'community-unverified'},
{id:'xumo-community',label:'Xumo · community-generated channel playlist',url:'https://raw.githubusercontent.com/BuddyChewChew/xumo-playlist-generator/main/playlists/xumo_playlist.m3u',country:'INT',priority:110,enabled:true,policy:'community-unverified'},
{id:'south-africa-community',label:'South Africa · community public TV playlist',url:'https://raw.githubusercontent.com/KrugerAdrian/IPTV-South-Africa/main/South-Africa.m3u',country:'ZA',priority:109,enabled:true,policy:'community-unverified'},
{id:'plex-fast-global',label:'Plex · global FAST channel playlist',url:'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plex_all.m3u',country:'INT',priority:108,enabled:true,policy:'community-unverified'},
{id:'samsung-tv-plus-global',label:'Samsung TV Plus · global FAST channel playlist',url:'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/samsungtvplus_all.m3u',country:'INT',priority:107,enabled:true,policy:'community-unverified'},
{id:'roku-fast-global',label:'Roku Channel · global FAST channel playlist',url:'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/roku_all.m3u',country:'INT',priority:106,enabled:true,policy:'community-unverified'},
{id:'italy-openiptv-community',label:'Italy · curated public and regional TV playlist',url:'https://raw.githubusercontent.com/xN1ckuz/OpenIPTVItaly/main/OpenIPTVItaly_No_EPG.m3u',country:'IT',priority:105,enabled:true,policy:'community-unverified'},
];
function attr(line:string,key:string){ return line.match(new RegExp(key+'="([^"]*)"'))?.[1]?.trim() || undefined; }
const clean=(v?:string)=>v?.replace(/\s+/g,' ').trim()||undefined;
export function parseM3U(text:string,source:TvSource,max=25000):TvChannel[]{
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/); const out:TvChannel[]=[]; let info:string|null=null;
 for(const raw of lines){ if(out.length>=max) break; const line=raw.trim(); if(!line) continue;
  if(line.startsWith('#EXTINF')){info=line;continue;} if(line.startsWith('#')) continue;
  if(!info || !/^https:\/\//i.test(line)){info=null;continue;}
  const comma=info.indexOf(','); const name=clean(comma>=0?info.slice(comma+1):attr(info,'tvg-name'))||'Live TV';
  const tvg_id=clean(attr(info,'tvg-id'));
  const logo=clean(attr(info,'tvg-logo')); const group=clean(attr(info,'group-title')); const country=clean(attr(info,'tvg-country'))||source.country; const language=clean(attr(info,'tvg-language'));
  const key=(name+'|'+line).toLowerCase(); const id=typeof btoa==='function'?btoa(unescape(encodeURIComponent(key))).replace(/[^a-z0-9]/gi,'').slice(0,80):key.slice(0,80);
  out.push({id,tvg_id,name,url:line,logo,group,country,language,source:source.label,priority:source.priority}); info=null;
 } return out;
}
function unwrapTvProxyUrl(value:string):string{
 let current=value;
 for(let i=0;i<3;i++){
  try{
   const parsed=new URL(current);
   if(!parsed.pathname.endsWith('/functions/v1/tv-stream-proxy')) return current;
   const nested=parsed.searchParams.get('url');
   if(!nested) return current;
   current=decodeURIComponent(nested);
  }catch{return current;}
 }
 return current;
}
export async function loadTvSource(source:TvSource,signal?:AbortSignal){
 // Secondary is the long-term canonical read plane for the large TV catalog.
 // During rollout it may be empty, so the primary catalog function remains a
 // safe ingestion fallback. No primary auth/session is sent to the secondary.
 try{
  const {data,error}=await supabaseSecondary
    .from('tv_catalog_channels')
    .select('channel_id,tvg_id,name,stream_url,logo_url,country,language,group_name,source,source_id,priority,is_active')
    .eq('source_id',source.id)
    .eq('is_active',true)
    .order('priority',{ascending:false})
    .limit(25000);
  if(!error && Array.isArray(data) && data.length){
   return data.map((c:any)=>({
    id:String(c.channel_id),
    tvg_id:c.tvg_id||undefined,
    name:String(c.name||'Live TV'),
    url:unwrapTvProxyUrl(String(c.stream_url)),
    logo:c.logo_url||undefined,
    country:c.country||source.country,
    language:c.language||undefined,
    group:c.group_name||undefined,
    source:String(c.source||source.label),
    priority:Number(c.priority||source.priority),
    live:true,
   } as TvChannel));
  }
 }catch{}
 const endpoint=supabaseUrl+'/functions/v1/tv-catalog?source='+encodeURIComponent(source.id);
 const response=await fetch(endpoint,{signal,headers:{Accept:'application/json'}});
 if(!response.ok) throw new Error(source.label+': HTTP '+response.status);
 const payload=await response.json();
 return Array.isArray(payload?.channels)?(payload.channels as TvChannel[]).map(c=>({...c,url:unwrapTvProxyUrl(String(c.url))})):[];
}
export function getPrioritySourceIds(){ return TV_SOURCES.filter(s=>s.enabled!==false).sort((a,b)=>b.priority-a.priority).map(s=>s.id); }
export async function loadTvHealth(channelIds:string[]){
 const wanted=new Set(channelIds.map(String));
 try{
  const {data,error}=await supabaseSecondary
    .from('tv_catalog_health')
    .select('channel_id,is_online,last_checked_at,latency_ms,consecutive_successes,priority')
    .eq('is_online',true)
    .limit(20000);
  if(!error && Array.isArray(data) && data.length){
   return new Map(data.filter((x:any)=>wanted.has(String(x.channel_id))).map((x:any)=>[String(x.channel_id),x]));
  }
 }catch{}
 const url=supabaseUrl+'/rest/v1/tv_channel_health?is_online=eq.true&select=channel_id,is_online,last_checked_at,latency_ms,consecutive_successes,priority&limit=20000';
 const r=await fetch(url,{headers:{Accept:'application/json'}});
 if(!r.ok) return new Map<string,any>();
 const rows=await r.json();
 return new Map((Array.isArray(rows)?rows:[]).filter((x:any)=>wanted.has(String(x.channel_id))).map((x:any)=>[String(x.channel_id),x]));
}
export function rankRecommendedTvChannels(channels:TvChannel[],health:Map<string,any>){
 return [...channels].sort((a,b)=>{
  const ah=health.get(a.id), bh=health.get(b.id);
  const as=(ah?.is_online?100000:0)+(ah?.consecutive_successes||0)*100+(ah?.latency_ms?Math.max(0,100-ah.latency_ms/20):0)+a.priority;
  const bs=(bh?.is_online?100000:0)+(bh?.consecutive_successes||0)*100+(bh?.latency_ms?Math.max(0,100-bh.latency_ms/20):0)+b.priority;
  return bs-as;
 });
}
export function dedupeTvChannels(channels:TvChannel[]){const seen=new Set<string>();return [...channels].filter(c=>{const key=c.url.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>b.priority-a.priority);}