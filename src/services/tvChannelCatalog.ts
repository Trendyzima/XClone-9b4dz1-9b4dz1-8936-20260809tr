import {supabaseUrl} from '@/lib/supabase';

export type TvChannel = { id:string; name:string; url:string; logo?:string; country?:string; language?:string; group?:string; source:string; priority:number };
export type TvSource = { id:string; label:string; url:string; country?:string; priority:number; enabled?:boolean; policy?:'public-free'|'community-unverified' };
export const TV_SOURCES: TvSource[] = [
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
{id:'iptv-org-news',label:'IPTV-ORG · News',url:'https://iptv-org.github.io/iptv/categories/news.m3u',country:'INT',priority:128,enabled:true,policy:'public-free'},
{id:'iptv-org-sports',label:'IPTV-ORG · Sports',url:'https://iptv-org.github.io/iptv/categories/sports.m3u',country:'INT',priority:127,enabled:true,policy:'public-free'},
{id:'iptv-org-music',label:'IPTV-ORG · Music',url:'https://iptv-org.github.io/iptv/categories/music.m3u',country:'INT',priority:126,enabled:true,policy:'public-free'},
];
function attr(line:string,key:string){ return line.match(new RegExp(key+'="([^"]*)"'))?.[1]?.trim() || undefined; }
const clean=(v?:string)=>v?.replace(/\s+/g,' ').trim()||undefined;
export function parseM3U(text:string,source:TvSource,max=180):TvChannel[]{
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/); const out:TvChannel[]=[]; let info:string|null=null;
 for(const raw of lines){ if(out.length>=max) break; const line=raw.trim(); if(!line) continue;
  if(line.startsWith('#EXTINF')){info=line;continue;} if(line.startsWith('#')) continue;
  if(!info || !/^https:\/\//i.test(line)){info=null;continue;}
  const comma=info.indexOf(','); const name=clean(comma>=0?info.slice(comma+1):attr(info,'tvg-name'))||'Live TV';
  const logo=clean(attr(info,'tvg-logo')); const group=clean(attr(info,'group-title')); const country=clean(attr(info,'tvg-country'))||source.country; const language=clean(attr(info,'tvg-language'));
  const key=(name+'|'+line).toLowerCase(); const id=typeof btoa==='function'?btoa(unescape(encodeURIComponent(key))).replace(/[^a-z0-9]/gi,'').slice(0,80):key.slice(0,80);
  out.push({id,name,url:line,logo,group,country,language,source:source.label,priority:source.priority}); info=null;
 } return out;
}
export async function loadTvSource(source:TvSource,signal?:AbortSignal){
 const endpoint=supabaseUrl+'/functions/v1/tv-catalog?source='+encodeURIComponent(source.id);
 const response=await fetch(endpoint,{signal,headers:{Accept:'application/json'}});
 if(!response.ok) throw new Error(source.label+': HTTP '+response.status);
 const payload=await response.json();
 return Array.isArray(payload?.channels)?payload.channels as TvChannel[]:[];
}
export function dedupeTvChannels(channels:TvChannel[]){const seen=new Set<string>();return [...channels].filter(c=>{const key=c.url.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>b.priority-a.priority);}