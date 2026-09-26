import {supabaseUrl} from '@/lib/supabase';

export type TvChannel = { id:string; name:string; url:string; logo?:string; country?:string; language?:string; group?:string; source:string; priority:number };
export type TvSource = { id:string; label:string; url:string; country?:string; priority:number; enabled?:boolean; policy?:'public-free'|'community-unverified' };
export const TV_SOURCES: TvSource[] = [
{id:'iptv-org-global',label:'IPTV-ORG · Global public',url:'https://iptv-org.github.io/iptv/index.m3u',country:'INT',priority:120,enabled:true,policy:'public-free'},
{id:'iptv-org-news',label:'IPTV-ORG · News',url:'https://iptv-org.github.io/iptv/categories/news.m3u',country:'INT',priority:118,enabled:true,policy:'public-free'},
{id:'iptv-org-sports',label:'IPTV-ORG · Sports',url:'https://iptv-org.github.io/iptv/categories/sports.m3u',country:'INT',priority:117,enabled:true,policy:'public-free'},
{id:'iptv-org-music',label:'IPTV-ORG · Music',url:'https://iptv-org.github.io/iptv/categories/music.m3u',country:'INT',priority:116,enabled:true,policy:'public-free'},
{id:'free-tv-global',label:'Free-TV/IPTV · Global free TV',url:'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',country:'INT',priority:110,enabled:true,policy:'public-free'},
{id:'free-tv-ke',label:'Free-TV/IPTV · Kenya',url:'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_kenya.m3u8',country:'KE',priority:109,enabled:true,policy:'public-free'},
{id:'iptv-org-ke',label:'IPTV-ORG · Kenya',url:'https://iptv-org.github.io/iptv/countries/ke.m3u',country:'KE',priority:105,enabled:true,policy:'public-free'},
{id:'iptv-org-int',label:'IPTV-ORG · Sub-Saharan Africa',url:'https://iptv-org.github.io/iptv/regions/ssa.m3u',country:'INT',priority:104,enabled:true,policy:'public-free'},
{id:'iptv-org-us',label:'IPTV-ORG · United States',url:'https://iptv-org.github.io/iptv/countries/us.m3u',country:'US',priority:90,enabled:true,policy:'public-free'},
{id:'iptv-org-gb',label:'IPTV-ORG · United Kingdom',url:'https://iptv-org.github.io/iptv/countries/gb.m3u',country:'GB',priority:88,enabled:true,policy:'public-free'},
{id:'iptv-org-za',label:'IPTV-ORG · South Africa',url:'https://iptv-org.github.io/iptv/countries/za.m3u',country:'ZA',priority:86,enabled:true,policy:'public-free'},
{id:'iptv-org-ng',label:'IPTV-ORG · Nigeria',url:'https://iptv-org.github.io/iptv/countries/ng.m3u',country:'NG',priority:84,enabled:true,policy:'public-free'},
{id:'iptv-org-gh',label:'IPTV-ORG · Ghana',url:'https://iptv-org.github.io/iptv/countries/gh.m3u',country:'GH',priority:82,enabled:true,policy:'public-free'},
{id:'fanmingming',label:'fanmingming/live · community',url:'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u',priority:75,enabled:false,policy:'community-unverified'},
{id:'iptv-cn',label:'IPTV-CN · archived',url:'https://raw.githubusercontent.com/IPTV-CN/IPTV/master/index.m3u',priority:72,enabled:false,policy:'community-unverified'},
{id:'yuechan',label:'YueChan/Live · community',url:'https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u',priority:70,enabled:false,policy:'community-unverified'},
{id:'yang',label:'YanG-1989/m3u · community',url:'https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u',priority:68,enabled:false,policy:'community-unverified'},
{id:'joevess',label:'joevess/IPTV · community',url:'https://raw.githubusercontent.com/joevess/IPTV/main/iptv.m3u8',priority:66,enabled:false,policy:'community-unverified'},
{id:'beijing',label:'Beijing-IPTV · community',url:'https://raw.githubusercontent.com/qwerttvv/Beijing-IPTV/master/IPTV-Mobile.m3u',priority:64,enabled:false,policy:'community-unverified'},
{id:'free-tv',label:'Free-TV/IPTV',url:'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',priority:60,enabled:true,policy:'public-free'},
{id:'imDazui',label:'Tvlist-awesome-m3u-m3u8 · community',url:'https://raw.githubusercontent.com/imDazui/Tvlist-awesome-m3u-m3u8/master/m3u/3100个全部有效.m3u8',priority:55,enabled:false,policy:'community-unverified'},
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