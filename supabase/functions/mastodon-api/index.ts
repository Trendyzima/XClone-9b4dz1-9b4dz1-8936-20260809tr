import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ROOT = "https://testagram.site";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const db = createClient(SUPABASE_URL, SECRET, { auth: { persistSession:false, autoRefreshToken:false } });
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,content-type,Idempotency-Key","Access-Control-Allow-Methods":"GET,POST,PATCH,DELETE,OPTIONS"};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{...CORS,"Content-Type":"application/json; charset=utf-8"}});
const str=(v:unknown)=>typeof v==="string"?v:"";
async function form(req:Request){if((req.headers.get("content-type")||"").includes("json"))return req.json();const p=new URLSearchParams(await req.text());const o:any={};for(const [k,v] of p){if(k.endsWith("[]"))(o[k.slice(0,-2)]??=[]).push(v);else o[k]=v}return o}
async function auth(req:Request){const h=req.headers.get("authorization")||"";if(!/^Bearer /i.test(h))return null;const access_token=h.replace(/^Bearer /i,"").trim();const r=await db.from("fediverse_oauth_codes").select("access_token,user_id,client_id,scope,expires_at").eq("access_token",access_token).maybeSingle();if(r.error)throw r.error;if(!r.data||r.data.expires_at&&new Date(r.data.expires_at)<new Date())return null;return {...r.data,scopes:str(r.data.scope||"read").split(/\s+/)} }
async function actorForUser(user_id:string){const r=await db.from("federated_actors").select("*").eq("user_id",user_id).maybeSingle();if(r.error)throw r.error;return r.data}
async function profile(id:string){const r=await db.from("profiles").select("*").eq("id",id).maybeSingle();if(r.error)throw r.error;return r.data}
async function account(id:string){const a=await db.from("federated_actors").select("*").eq("id",id).maybeSingle();if(a.error)throw a.error;if(!a.data)return null;const p=a.data.user_id?await profile(a.data.user_id):null;const host=a.data.actor_url?new URL(a.data.actor_url).hostname:"";return {id:String(a.data.id),username:str(a.data.preferred_username||a.data.username),acct:a.data.user_id?str(p?.username||a.data.preferred_username):`${str(a.data.preferred_username||a.data.username)}@${host}`,display_name:str(p?.display_name||a.data.display_name||a.data.preferred_username),note:str(p?.bio||a.data.summary),url:str(a.data.actor_url||a.data.uri),avatar:str(p?.avatar_url||a.data.avatar_url),avatar_static:str(p?.avatar_url||a.data.avatar_url),header:str(p?.cover_url||a.data.header_url),header_static:str(p?.cover_url||a.data.header_url),locked:Boolean(a.data.locked),discoverable:a.data.discoverable!==false,bot:false,followers_count:Number(p?.follower_count||0),following_count:Number(p?.following_count||0),statuses_count:0,created_at:p?.created_at||a.data.created_at,fields:[],emojis:[],roles:[]}}
async function status(id:string,viewer:string|null){const p=await db.from("posts").select("*").eq("id",id).maybeSingle();if(!p.data)return null;const a=await actorForUser(p.data.author_id);const ac=a?await account(String(a.id)):null;const media=await db.from("post_media").select("*").eq("post_id",id).order("sort_order");let fav=false,reblog=false,bookmark=false;if(viewer){fav=!!(await db.from("post_likes").select("post_id").eq("post_id",id).eq("user_id",viewer).maybeSingle()).data;reblog=!!(await db.from("post_reposts").select("post_id").eq("post_id",id).eq("user_id",viewer).maybeSingle()).data;bookmark=!!(await db.from("bookmarks").select("post_id").eq("post_id",id).eq("user_id",viewer).maybeSingle()).data}const uri=`${a?.actor_url||ROOT+"/users/"+ac?.username}/notes/${id}`;const authorProfile=ac?.id?await profile(String(p.data.author_id)):null; const quoted=p.data.quoted_post_id?{id:String(p.data.quoted_post_id),url:`${ROOT}/api/v1/statuses/${p.data.quoted_post_id}`}:null; const quotePolicy=String(authorProfile?.fediverse_quote_policy||"public"); return {id:String(id),created_at:p.data.created_at,edited_at:p.data.edited_at||p.data.updated_at||null,in_reply_to_id:p.data.reply_to_post_id?String(p.data.reply_to_post_id):null,in_reply_to_account_id:null,sensitive:false,spoiler_text:"",visibility:p.data.visibility==='followers'?'private':'public',language:p.data.language_code||null,uri,url:uri,account:ac,content:str(p.data.content||p.data.body),text:str(p.data.content||p.data.body),media_attachments:(media.data||[]).map((m:any)=>({id:String(m.id),type:m.media_type==='video'?'video':m.media_type==='audio'?'audio':'image',url:m.media_url,preview_url:m.media_url,remote_url:m.media_url,meta:null,description:null,blurhash:null})),mentions:[],tags:[],emojis:[],reblogs_count:Number(p.data.reposts_count||0),favourites_count:Number(p.data.likes_count||0),replies_count:Number(p.data.replies_count||0),quote_count:Number(p.data.quote_count||0),favourited:fav,reblogged:reblog,bookmarked:bookmark,muted:false,poll:null,card:null,reblog:null,poll:await pollForPost(id,viewer),quote:quoted,quote_approval:{automatic:quotePolicy==="public"||quotePolicy==="followers",current_user:quotePolicy==="public"||quotePolicy==="followers"},application:{name:"Testagram",website:"https://www.testagram.site"}}}
async function pollForPost(postId:string,viewer:string|null){
  const p=await db.from("polls").select("*").eq("post_id",postId).maybeSingle(); if(p.error)throw p.error; if(!p.data)return null;
  const o=await db.from("poll_options").select("id,label,position,vote_count").eq("poll_id",p.data.id).order("position"); if(o.error)throw o.error;
  let ownIds:string[]=[]; if(viewer){const v=await db.from("poll_votes").select("option_id").eq("poll_id",p.data.id).eq("voter_id",viewer); if(v.error)throw v.error; ownIds=(v.data||[]).map((x:any)=>String(x.option_id));}
  return {id:String(p.data.id),expires_at:p.data.ends_at,expired:!!p.data.ends_at&&new Date(p.data.ends_at)<new Date(),expiring:false,multiple:Boolean(p.data.allow_multiple),votes_count:(o.data||[]).reduce((n:any,x:any)=>n+Number(x.vote_count||0),0),voters_count:null,options:(o.data||[]).map((x:any)=>({title:String(x.label),votes:Number(x.vote_count||0)})),voted:ownIds.length>0,own_votes:ownIds.map(id=>Number((o.data||[]).findIndex((x:any)=>String(x.id)===id)))};
}
async function instance(){const u=await db.from("profiles").select("id",{count:"exact",head:true});const p=await db.from("posts").select("id",{count:"exact",head:true}).is("deleted_at",null);return {domain:new URL(ROOT).hostname,title:"Testagram",version:"1.0.0",source_url:"https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr",description:"Testagram ActivityPub/Mastodon-compatible serverless instance",usage:{users:{active_month:u.count||0},statuses:{total:p.count||0}},registrations:{enabled:true,approval_required:false},configuration:{statuses:{max_characters:5000,max_media_attachments:4,characters_reserved_per_url:23},media_attachments:{description_limit:1500,image_size_limit:20971520,video_size_limit:20971520},polls:{max_options:4,max_characters_per_option:160,min_expiration:300,max_expiration:2629746}},api_versions:{mastodon:7},rules:[]}}


async function viewerFromToken(t:any){return t?.user_id||null}
async function postRows(ids:string[],viewer:string|null){return (await Promise.all(ids.map(id=>status(id,viewer)))).filter(Boolean)}
async function notificationRows(userId:string,limit:number){const q=await db.from("notifications").select("*").eq("recipient_id",userId).order("created_at",{ascending:false}).limit(limit);if(q.error)throw q.error;return Promise.all((q.data||[]).map(async(n:any)=>{const actor=n.actor_id?await db.from("profiles").select("id,username,display_name,avatar_url").eq("id",n.actor_id).maybeSingle():{data:null};const s=n.post_id?await status(String(n.post_id),userId):null;const type=n.kind==="like"?"favourite":n.kind==="repost"||n.kind==="boost"?"reblog":n.kind==="follow"?"follow":n.kind==="mention"?"mention":n.kind==="quote"?"quote":"status";return {id:String(n.id),type,created_at:n.created_at,account:actor.data?{id:String(actor.data.id),username:actor.data.username,acct:actor.data.username,display_name:actor.data.display_name||actor.data.username,avatar:actor.data.avatar_url}:null,status:s};}))}
async function listRows(userId:string){const q=await db.from("lists").select("*").eq("owner_id",userId).order("created_at",{ascending:false});if(q.error)throw q.error;return q.data||[]}

Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});try{const u=new URL(req.url),path=u.pathname.replace(/^\/functions\/v1\/mastodon-api/,"")||u.pathname,t=await auth(req);if(path.endsWith('/api/v2/instance')||path.endsWith('/api/v1/instance'))return json(await instance());async function relationshipForAccount(userId:string, accountId:string){
  const a=await db.from("federated_actors").select("id,user_id,actor_url,uri").eq("id",accountId).maybeSingle();
  if(a.error)throw a.error;
  if(!a.data)return {id:accountId,following:false,requested:false,followed_by:false,muting:false,blocking:false,domain_blocking:false,showing_reblogs:true,notifying:false};
  const uid=a.data.user_id as string|null;
  let following=false,requested=false,followedBy=false,muting=false,blocking=false;
  if(uid){
    const f=await db.from("follows").select("status").eq("follower_id",userId).eq("following_id",uid).maybeSingle();
    const rf=await db.from("follows").select("status").eq("follower_id",uid).eq("following_id",userId).maybeSingle();
    const m=await db.from("mutes").select("muted_id").eq("muter_id",userId).eq("muted_id",uid).maybeSingle();
    const b=await db.from("blocks").select("blocked_id").eq("blocker_id",userId).eq("blocked_id",uid).maybeSingle();
    following=f.data?.status==="accepted"; requested=f.data?.status==="pending"; followedBy=rf.data?.status==="accepted"; muting=!!m.data; blocking=!!b.data;
  } else if(a.data.actor_url||a.data.uri){
    const fr=await db.from("federated_follow_relationships").select("state").eq("local_user_id",userId).eq("remote_actor_uri",a.data.actor_url||a.data.uri).eq("direction","following").maybeSingle();
    following=["active","accepted","pending"].includes(fr.data?.state||"");
    requested=fr.data?.state==="pending";
  }
  return {id:String(accountId),following,requested,followed_by:followedBy,muting,blocking,domain_blocking:false,showing_reblogs:true,notifying:false};
}
async function relationshipAccounts(userId:string, ids:string[]){
  return Promise.all([...new Set(ids.filter(Boolean))].slice(0,100).map(id=>relationshipForAccount(userId,id)));
}

if(path==='/api/v1/accounts/verify_credentials'){if(!t?.user_id)return json({error:'The access token is invalid'},401);const a=await actorForUser(t.user_id);return a?json(await account(String(a.id))):json({error:'Account actor unavailable'},409)}if(path==='/api/v1/accounts/relationships'&&req.method==='GET'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401);
  return json(await relationshipAccounts(t.user_id,u.searchParams.getAll('id')));
}
if((m=path.match(/^\/api\/v1\/timelines\/tag\/([^/]+)$/))&&req.method==='GET'){
  const tag=decodeURIComponent(m[1]).replace(/^#/,'').toLowerCase(); const q=await db.from('posts').select('*').is('deleted_at',null).ilike('content',`%#${tag}%`).order('created_at',{ascending:false}).limit(Math.min(Number(u.searchParams.get('limit')||20),40));
  if(q.error)throw q.error; return json(await Promise.all((q.data||[]).map((p:any)=>status(String(p.id),t?.user_id||null))));
}
if(path==='/api/v1/timelines/public'){const q=await db.from('posts').select('*').is('deleted_at',null).eq('visibility','public').order('created_at',{ascending:false}).limit(Math.min(Number(u.searchParams.get('limit')||20),40));return json(await Promise.all((q.data||[]).map((p:any)=>status(String(p.id),t?.user_id||null))))}if(path==='/api/v1/timelines/home'){if(!t?.user_id)return json({error:'The access token is invalid'},401);const f=await db.from('follows').select('following_id').eq('follower_id',t.user_id).eq('status','accepted');const ids=[t.user_id,...(f.data||[]).map((x:any)=>x.following_id)];const q=await db.from('posts').select('*').in('author_id',ids).is('deleted_at',null).order('created_at',{ascending:false}).limit(Math.min(Number(u.searchParams.get('limit')||20),40));return json(await Promise.all((q.data||[]).map((p:any)=>status(String(p.id),t.user_id))))}const am=path.match(/^\/api\/v1\/accounts\/([^/]+)$/);if(am&&req.method==='GET'){const a=await account(decodeURIComponent(am[1]));return a?json(a):json({error:'Record not found'},404)}const sm=path.match(/^\/api\/v1\/statuses\/([^/]+)$/);if(sm&&req.method==='GET'){const s=await status(decodeURIComponent(sm[1]),t?.user_id||null);return s?json(s):json({error:'Record not found'},404)}if(path==='/api/v2/search'){const q=str(u.searchParams.get('q')).trim();const out:any={accounts:[],statuses:[],hashtags:[]};if(q){const a=await db.from('profiles').select('id,username,display_name').or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).limit(20);for(const p of a.data||[]){const ac=await actorForUser(p.id);if(ac){const x=await account(String(ac.id));if(x)out.accounts.push(x)}}const s=await db.from('posts').select('id').ilike('content',`%${q}%`).is('deleted_at',null).limit(20);out.statuses=(await Promise.all((s.data||[]).map((x:any)=>status(String(x.id),t?.user_id||null)))).filter(Boolean)}return json(out)}if(path==='/api/v1/apps'&&req.method==='POST'){const b=await form(req),client_id=crypto.randomUUID().replaceAll('-',''),client_secret=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),redirect_uris=Array.isArray(b.redirect_uris)?b.redirect_uris:str(b.redirect_uris||'urn:ietf:wg:oauth:2.0:oob').split(/[\s\n]+/).filter(Boolean),scopes=str(b.scopes||'read').split(/\s+/);const r=await db.from('fediverse_oauth_apps').insert({client_id,client_secret,client_name:str(b.client_name)||'Mastodon App',website:str(b.website)||null,redirect_uris,scopes}).select('*').single();if(r.error)throw r.error;return json({id:String(r.data.id),name:r.data.client_name,website:r.data.website,scopes,redirect_uris,redirect_uri:redirect_uris.join('\n'),client_id,client_secret,client_secret_expires_at:0})}
// Core Mastodon-compatible write/read surfaces backed by canonical Testagram tables.
if((m=path.match(/^\/api\/v1\/polls\/([^/]+)\/votes$/))&&req.method==='POST'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401); const b=await form(req),ids=(Array.isArray(b.choices)?b.choices:[b.choices]).filter((x:any)=>x!==undefined&&x!=='').map((x:any)=>Number(x)),pollId=decodeURIComponent(m[1]);
  const opts=await db.from('poll_options').select('id,position').eq('poll_id',pollId).order('position'); const poll=await db.from('polls').select('allow_multiple,ends_at,post_id').eq('id',pollId).maybeSingle(); if(opts.error)throw opts.error;if(poll.error)throw poll.error;if(!poll.data)return json({error:'Record not found'},404);
  if(poll.data.ends_at&&new Date(poll.data.ends_at)<new Date())return json({error:'Poll has expired'},422); if(!poll.data.allow_multiple&&ids.length>1)return json({error:'Multiple choices are not allowed'},422);
  await db.from('poll_votes').delete().eq('poll_id',pollId).eq('voter_id',t.user_id); for(const idx of ids){const opt=opts.data?.find((x:any)=>Number(x.position)===idx);if(opt)await db.from('poll_votes').insert({poll_id:pollId,option_id:opt.id,voter_id:t.user_id});}
  for(const opt of opts.data||[]){const n=await db.from('poll_votes').select('id',{count:'exact',head:true}).eq('option_id',opt.id);await db.from('poll_options').update({vote_count:n.count||0}).eq('id',opt.id);}
  return json(await pollForPost(String(poll.data.post_id),t.user_id));
}
if(path==='/api/v1/statuses'&&req.method==='POST'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401);
  const b=await form(req), content=str(b.status||b.content).trim();
  if(!content||content.length>5000)return json({error:'status is required'},422);
  const vis=str(b.visibility||'public'); const replyId=str(b.in_reply_to_id||'');
  const ins=await db.from('posts').insert({user_id:t.user_id,author_id:t.user_id,content,visibility:vis==='private'?'followers':vis,reply_to_post_id:replyId||null}).select('id').single();
  if(ins.error)throw ins.error; const s=await status(String(ins.data.id),t.user_id); return json(s,200);
}
const statusWrite=path.match(/^\/api\/v1\/statuses\/([^/]+)\/(favourite|unfavourite|reblog|unreblog|bookmark|unbookmark)$/);
if(statusWrite&&req.method==='POST'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401);
  const id=decodeURIComponent(statusWrite[1]), action=statusWrite[2];
  const p=await db.from('posts').select('id').eq('id',id).is('deleted_at',null).maybeSingle(); if(!p.data)return json({error:'Record not found'},404);
  if(action==='favourite'||action==='unfavourite'){
    if(action==='favourite') await db.from('post_likes').upsert({post_id:id,user_id:t.user_id},{onConflict:'post_id,user_id'}); else await db.from('post_likes').delete().eq('post_id',id).eq('user_id',t.user_id);
  } else if(action==='reblog'||action==='unreblog'){
    if(action==='reblog') await db.from('reposts').upsert({post_id:id,user_id:t.user_id},{onConflict:'post_id,user_id'}); else await db.from('reposts').delete().eq('post_id',id).eq('user_id',t.user_id);
  } else if(action==='bookmark'||action==='unbookmark'){
    if(action==='bookmark') await db.from('bookmarks').upsert({post_id:id,user_id:t.user_id},{onConflict:'post_id,user_id'}); else await db.from('bookmarks').delete().eq('post_id',id).eq('user_id',t.user_id);
  }
  return json(await status(id,t.user_id));
}
if(path==='/api/v1/bookmarks'&&req.method==='GET'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401);
  const q=await db.from('bookmarks').select('post_id').eq('user_id',t.user_id).order('created_at',{ascending:false}).limit(Math.min(Number(u.searchParams.get('limit')||20),40)); if(q.error)throw q.error;
  return json(await postRows((q.data||[]).map((x:any)=>String(x.post_id)),t.user_id));
}
if(path==='/api/v1/favourites'&&req.method==='GET'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401);
  const q=await db.from('post_likes').select('post_id').eq('user_id',t.user_id).order('created_at',{ascending:false}).limit(Math.min(Number(u.searchParams.get('limit')||20),40)); if(q.error)throw q.error;
  return json(await postRows((q.data||[]).map((x:any)=>String(x.post_id)),t.user_id));
}
if(path==='/api/v1/mutes'&&req.method==='GET'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401);
  const q=await db.from('mutes').select('muted_id').eq('muter_id',t.user_id).order('created_at',{ascending:false}).limit(40); if(q.error)throw q.error;
  const out=[]; for(const x of q.data||[]){const a=await actorForUser(String(x.muted_id)); if(a){const ac=await account(String(a.id)); if(ac)out.push(ac);}}
  return json(out);
}
if(path==='/api/v1/blocks'&&req.method==='GET'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401);
  const q=await db.from('blocks').select('blocked_id').eq('blocker_id',t.user_id).order('created_at',{ascending:false}).limit(40); if(q.error)throw q.error;
  const out=[]; for(const x of q.data||[]){const a=await actorForUser(String(x.blocked_id)); if(a){const ac=await account(String(a.id)); if(ac)out.push(ac);}}
  return json(out);
}
if(path==='/api/v1/filters'&&req.method==='GET'){if(!t?.user_id)return json({error:'The access token is invalid'},401);const q=await db.from('fediverse_content_filters').select('*').eq('user_id',t.user_id).order('created_at',{ascending:false});if(q.error)throw q.error;return json((q.data||[]).map((x:any)=>({id:String(x.id),title:x.name,context:x.contexts||['home','notifications','public','thread'],filter_action:x.action||'warn',expires_at:x.expires_at,keywords:[{id:String(x.id),keyword:x.phrase,whole_word:false}]})));}
if(path==='/api/v1/notifications'&&req.method==='GET'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401);
  return json(await notificationRows(t.user_id,Math.min(Number(u.searchParams.get('limit')||20),40)));
}
if(path==='/api/v1/notifications/clear'&&req.method==='POST'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401);
  const q=await db.from('notifications').update({read_at:new Date().toISOString()}).eq('recipient_id',t.user_id).is('read_at',null); if(q.error)throw q.error; return json({});
}
if(path==='/api/v1/lists'&&req.method==='GET'){if(!t?.user_id)return json({error:'The access token is invalid'},401);return json(await listRows(t.user_id))}
if(path==='/api/v1/lists'&&req.method==='POST'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401); const b=await form(req); const name=str(b.title||b.name).trim(); if(!name)return json({error:'title is required'},422);
  const q=await db.from('lists').insert({owner_id:t.user_id,name,description:str(b.description)||null,is_private:Boolean(b.replies_policy==='none')}).select('*').single(); if(q.error)throw q.error; return json(q.data,200);
}
const listMatch=path.match(/^\/api\/v1\/lists\/([^/]+)(?:\/(accounts|statuses))?$/);
if(listMatch&&req.method==='GET'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401); const lid=decodeURIComponent(listMatch[1]), sub=listMatch[2];
  if(!sub){const q=await db.from('lists').select('*').eq('id',lid).eq('owner_id',t.user_id).maybeSingle();return q.data?json(q.data):json({error:'Record not found'},404)}
  if(sub==='accounts'){const q=await db.from('list_members').select('user_id').eq('list_id',lid);if(q.error)throw q.error;const ids=(q.data||[]).map((x:any)=>String(x.user_id));const rows=[];for(const id of ids){const a=await actorForUser(id);if(a){const x=await account(String(a.id));if(x)rows.push(x)}}return json(rows)}
  const q=await db.rpc('get_list_timeline',{p_list_id:lid,p_limit:Math.min(Number(u.searchParams.get('limit')||20),40),p_offset:0});if(q.error)throw q.error;const rows=(q.data||[]).map((x:any)=>String(x.id));return json(await postRows(rows,t.user_id));
}
if(listMatch&&req.method==='POST'&&listMatch[2]==='accounts'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401); const lid=decodeURIComponent(listMatch[1]), b=await form(req); const ids=Array.isArray(b.account_ids)?b.account_ids:[b.account_id].filter(Boolean);
  for(const id of ids){const a=await db.from('federated_actors').select('user_id').eq('id',String(id)).maybeSingle();const uid=a.data?.user_id||String(id);await db.from('list_members').upsert({list_id:lid,user_id:uid},{onConflict:'list_id,user_id'})} return json({});
}
if(listMatch&&req.method==='DELETE'&&listMatch[2]==='accounts'){
  if(!t?.user_id)return json({error:'The access token is invalid'},401); const lid=decodeURIComponent(listMatch[1]), b=await form(req); const ids=Array.isArray(b.account_ids)?b.account_ids:[b.account_id].filter(Boolean);
  for(const id of ids){const a=await db.from('federated_actors').select('user_id').eq('id',String(id)).maybeSingle();const uid=a.data?.user_id||String(id);await db.from('list_members').delete().eq('list_id',lid).eq('user_id',uid)} return json({});
}
const accountActions=path.match(/^\/api\/v1\/accounts\/([^/]+)\/(follow|unfollow|statuses)$/);
if(accountActions&&req.method==='GET'&&accountActions[2]==='statuses'){const aid=decodeURIComponent(accountActions[1]),a=await db.from('federated_actors').select('user_id').eq('id',aid).maybeSingle();const uid=a.data?.user_id||aid;const q=await db.from('posts').select('id').eq('author_id',uid).is('deleted_at',null).order('created_at',{ascending:false}).limit(Math.min(Number(u.searchParams.get('limit')||20),40));if(q.error)throw q.error;return json(await postRows((q.data||[]).map((x:any)=>String(x.id)),t?.user_id||null))}
if(accountActions&&(req.method==='POST'||req.method==='DELETE')&&(accountActions[2]==='follow'||accountActions[2]==='unfollow')){
  if(!t?.user_id)return json({error:'The access token is invalid'},401);
  const aid=decodeURIComponent(accountActions[1]),a=await db.from('federated_actors').select('user_id,actor_url,uri').eq('id',aid).maybeSingle(); if(a.error)throw a.error;
  const remoteUri=a.data?.actor_url||a.data?.uri||'';
  if(!a.data?.user_id && /^https?:\/\//i.test(remoteUri)){
    const op=accountActions[2]==='follow'?'follow':'unfollow';
    const rr=await fetch(`${SUPABASE_URL}/functions/v1/federation-transport`,{method:'POST',headers:{'Authorization':`Bearer ${SECRET}`,apikey:SECRET,'Content-Type':'application/json'},body:JSON.stringify({operation:op,user_id:t.user_id,target:remoteUri})});
    const data=await rr.json().catch(()=>({})); if(!rr.ok)return json({error:data?.error||'Federation transport failed'},502);
    return json({...await relationshipForAccount(t.user_id,aid),account:await account(aid)});
  }
  const uid=a.data?.user_id||aid;
  if(accountActions[2]==='follow')await db.from('follows').upsert({follower_id:t.user_id,following_id:uid,status:'accepted'},{onConflict:'follower_id,following_id'});else await db.from('follows').delete().eq('follower_id',t.user_id).eq('following_id',uid);
  return json({...await relationshipForAccount(t.user_id,aid),account:await account(aid)});
}
const scheduled=path.match(/^\/api\/v1\/scheduled_statuses(?:\/([^/]+))?$/);
if(scheduled&&req.method==='GET'){if(!t?.user_id)return json({error:'The access token is invalid'},401);const q=await db.from('scheduled_posts').select('*').eq('author_id',t.user_id).eq('status','scheduled').order('scheduled_for',{ascending:true});if(q.error)throw q.error;return json((q.data||[]).map((x:any)=>({id:String(x.id),scheduled_at:x.scheduled_for,params:{text:x.body,visibility:'public',media_ids:[]}})))}
if(scheduled&&scheduled[1]&&req.method==='DELETE'){if(!t?.user_id)return json({error:'The access token is invalid'},401);const q=await db.from('scheduled_posts').delete().eq('id',decodeURIComponent(scheduled[1])).eq('author_id',t.user_id);if(q.error)throw q.error;return json({})}

return json({error:'Mastodon endpoint not implemented by a native Testagram capability'},404)}catch(e){console.error('[mastodon-api]',e);return json({error:e instanceof Error?e.message:'Mastodon API failure'},500)}});