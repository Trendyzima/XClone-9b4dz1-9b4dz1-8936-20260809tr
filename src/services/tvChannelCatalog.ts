export type TvChannel = { id:string; name:string; url:string; logo?:string; country?:string; language?:string; group?:string; source:string };
export type TvSource = { id:string; label:string; url:string; country?:string; priority:number };
export const TV_SOURCES: TvSource[] = [
{id:'iptv-org-ke',label:'IPTV.org · Kenya',url:'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/ke.m3u',country:'KE',priority:100},
{id:'iptv-org-int',label:'IPTV.org · International',url:'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/int.m3u',country:'INT',priority:95},
{id:'iptv-org-us',label:'IPTV.org · United States',url:'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/us.m3u',country:'US',priority:90},
{id:'iptv-org-gb',label:'IPTV.org · United Kingdom',url:'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/gb.m3u',country:'GB',priority:88},
{id:'iptv-org-za',label:'IPTV.org · South Africa',url:'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/za.m3u',country:'ZA',priority:86},
{id:'iptv-org-ng',label:'IPTV.org · Nigeria',url:'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/ng.m3u',country:'NG',priority:84},
{id:'iptv-org-gh',label:'IPTV.org · Ghana',url:'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/gh.m3u',country:'GH',priority:82},
{id:'fanmingming',label:'fanmingming/live',url:'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u',priority:75},
{id:'iptv-cn',label:'IPTV-CN',url:'https://raw.githubusercontent.com/IPTV-CN/IPTV/master/index.m3u',priority:72},
{id:'yuechan',label:'YueChan/Live',url:'https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u',priority:70},
{id:'yang',label:'YanG-1989/m3u',url:'https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u',priority:68},
{id:'joevess',label:'joevess/IPTV',url:'https://raw.githubusercontent.com/joevess/IPTV/main/iptv.m3u8',priority:66},
{id:'beijing',label:'Beijing-IPTV',url:'https://raw.githubusercontent.com/qwerttvv/Beijing-IPTV/master/IPTV-Mobile.m3u',priority:64},
{id:'free-tv',label:'Free-TV/IPTV',url:'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',priority:60},
{id:'imDazui',label:'Tvlist-awesome-m3u-m3u8',url:'https://raw.githubusercontent.com/imDazui/Tvlist-awesome-m3u-m3u8/master/m3u/3100个全部有效.m3u8',priority:55},
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
  out.push({id,name,url:line,logo,group,country,language,source:source.label}); info=null;
 } return out;
}
export async function loadTvSource(source:TvSource,signal?:AbortSignal){ const response=await fetch(source.url,{signal,headers:{Accept:'application/vnd.apple.mpegurl,text/plain,*/*'}}); if(!response.ok) throw new Error(source.label+': HTTP '+response.status); return parseM3U(await response.text(),source); }
export function dedupeTvChannels(channels:TvChannel[]){const seen=new Set<string>();return channels.filter(c=>{const key=c.url.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});}