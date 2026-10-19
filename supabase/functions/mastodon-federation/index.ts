import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const ROOT='https://testagram.site';
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Deno.env.get('SUPABASE_SECRET_KEY')||'';
const db=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const AP='https://www.w3.org/ns/activitystreams',SEC='https://w3id.org/security/v1',TOOT='http://joinmastodon.org/ns#';
const H={'Content-Type':'application/activity+json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'no-store','CDN-Cache-Control':'no-store'};
const json=(v:unknown,s=200,extra:Record<string,string>={})=>new Response(JSON.stringify(v),{status:s,headers:{...H,...extra}});
let nodeInfoStatsCache:{users:number;posts:number;expiresAt:number}|null=null;
async function getNodeInfoStats(){
  const now=Date.now();
  if(nodeInfoStatsCache&&nodeInfoStatsCache.expiresAt>now)return nodeInfoStatsCache;

  // Discovery metadata must remain available while the primary database is
  // degraded. Preserve the last known values as stale-if-error data, and put a
  // hard deadline around best-effort planner estimates. Never make federation
  // discovery wait for Supabase's gateway/database timeout.
  const stale=nodeInfoStatsCache;
  let timeoutId:ReturnType<typeof setTimeout>|undefined;
  const controller=new AbortController();
  const deadline=new Promise<never>((_,reject)=>{
    timeoutId=setTimeout(()=>{
      controller.abort();
      reject(new Error('NodeInfo statistics query exceeded its 1500ms budget'));
    },1500);
  });
  try{
    const stats=await Promise.race([
      (async()=>{
        const [users,posts]=await Promise.all([
          db.from('profiles').select('id',{count:'planned',head:true}).abortSignal(controller.signal),
          db.from('posts').select('id',{count:'planned',head:true}).is('deleted_at',null).abortSignal(controller.signal)
        ]);
        if(users.error)throw users.error;
        if(posts.error)throw posts.error;
        return {users:Number(users.count||0),posts:Number(posts.count||0),expiresAt:Date.now()+5*60*1000};
      })(),
      deadline
    ]);
    nodeInfoStatsCache=stats;
    return stats;
  }catch(error){
    console.warn('[mastodon-federation] NodeInfo stats degraded; serving stale or safe fallback metadata',error);
    if(stale)return stale;
    // NodeInfo's usage fields are descriptive, not authorization decisions.
    // Zero is safer than taking the entire protocol discovery endpoint offline.
    const fallback={users:0,posts:0,expiresAt:Date.now()+30_000};
    nodeInfoStatsCache=fallback;
    return fallback;
  }finally{
    if(timeoutId)clearTimeout(timeoutId);
  }
}
const str=(v:unknown)=>typeof v==='string'?v:'';const uri=(v:unknown)=>typeof v==='string'?v:v&&typeof v==='object'?str((v as any).id):'';
const context=[AP,SEC,{toot:TOOT,discoverable:'toot:discoverable',indexable:'toot:indexable',featured:'toot:featured'}];
async function ensureActivityPubIdentity(userId:string){
  if(!SERVICE)throw new Error('ActivityPub identity provisioning is unavailable');
  // Provisioning is a recovery path, not permission to hold public WebFinger open
  // indefinitely. A missing/stale keygen deployment or an unhealthy gateway must
  // fail quickly and leave a useful server-side diagnostic.
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(`${SUPABASE_URL}/functions/v1/activitypub-keygen`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${SERVICE}`,'x-testagram-internal':SERVICE},
      body:JSON.stringify({user_id:userId}),
      signal:controller.signal
    });
    if(!response.ok){
      const detail=(await response.text().catch(()=>'')).slice(0,500);
      throw new Error(`ActivityPub identity provisioning failed (${response.status})${detail?': '+detail:''}`);
    }
  }catch(error){
    if(controller.signal.aborted)throw new Error('ActivityPub identity provisioning timed out after 8000ms');
    throw error;
  }finally{
    clearTimeout(timeout);
  }
}
async function actor(username:string){
  const profile=await db.from('profiles')
    .select('id,username,account_status,display_name,bio,avatar_url,cover_url,protected_account')
    .eq('username',username).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  if(profile.error)throw profile.error;
  if(profile.data){
    if(profile.data.account_status!=='active')return null;
    // Fetch the actor and signing key in parallel and reuse both results. The
    // previous path queried actor/key for existence, then fetched them again,
    // adding three unnecessary PostgREST round trips to every local actor lookup.
    let [actorResult,keyResult]=await Promise.all([
      db.from('activitypub_actors')
        .select('actor_id,username,user_id,inbox_url,outbox_url,followers_url,following_url')
        .eq('user_id',profile.data.id).abortSignal(AbortSignal.timeout(5000)).maybeSingle(),
      db.from('activitypub_keys')
        .select('key_id,public_key_pem')
        .eq('user_id',profile.data.id).abortSignal(AbortSignal.timeout(5000)).maybeSingle()
    ]);
    if(actorResult.error)throw actorResult.error;
    if(keyResult.error)throw keyResult.error;
    if(!actorResult.data||!keyResult.data?.public_key_pem){
      await ensureActivityPubIdentity(String(profile.data.id));
      [actorResult,keyResult]=await Promise.all([
        db.from('activitypub_actors')
          .select('actor_id,username,user_id,inbox_url,outbox_url,followers_url,following_url')
          .eq('user_id',profile.data.id).abortSignal(AbortSignal.timeout(5000)).maybeSingle(),
        db.from('activitypub_keys')
          .select('key_id,public_key_pem')
          .eq('user_id',profile.data.id).abortSignal(AbortSignal.timeout(5000)).maybeSingle()
      ]);
      if(actorResult.error)throw actorResult.error;
      if(keyResult.error)throw keyResult.error;
    }
    if(!actorResult.data||!keyResult.data?.public_key_pem){
      throw new Error('Local ActivityPub actor or signing key is missing after provisioning');
    }
    const local=actorResult.data;
    return {
      ...local,
      actor_url:local.actor_id,
      public_key_id:keyResult.data.key_id||local.actor_id+'#main-key',
      public_key_pem:keyResult.data.public_key_pem,
      display_name:profile.data.display_name||username,
      bio:profile.data.bio||null,
      avatar_url:profile.data.avatar_url||null,
      header_url:profile.data.cover_url||null,
      locked:profile.data.protected_account===true
    };
  }
  // Only return cached remote actors when no local profile owns this username.
  const remote=await db.from('federated_actors').select('*') .eq('username',username).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  if(remote.error)throw remote.error;
  return remote.data||null;
}
function actorJson(a:any){const id=str(a?.actor_url||a?.uri)||`${ROOT}/users/${encodeURIComponent(a.username||a.preferred_username)}`,u=str(a?.username||a?.preferred_username),inbox=str(a?.inbox_url)||`${id}/inbox`;return {'@context':context,id,type:str(a?.actor_type)||'Person',preferredUsername:u,name:str(a?.display_name)||u,summary:str(a?.summary),url:id,inbox,outbox:str(a?.outbox_url)||`${id}/outbox`,followers:str(a?.followers_url)||`${id}/followers`,following:str(a?.following_url)||`${id}/following`,endpoints:{sharedInbox:`${ROOT}/inbox`},discoverable:a?.discoverable!==false,indexable:true,manuallyApprovesFollowers:a?.locked===true,publicKey:{id:str(a?.public_key_id)||`${id}#main-key`,owner:id,publicKeyPem:str(a?.public_key_pem)},...(a?.avatar_url?{icon:{type:'Image',mediaType:'image/*',url:a.avatar_url}}:{}),...(a?.header_url?{image:{type:'Image',mediaType:'image/*',url:a.header_url}}:{})};}
function hashtagTags(row:any){
  const existing=Array.isArray(row.tags)?row.tags.filter((x:any)=>x&&typeof x==='object'):[];
  const seen=new Set(existing.map((x:any)=>String(x.name??'').toLowerCase()));
  const text=str(row.content);
  const matches=[...text.matchAll(/(^|[^\w])#([A-Za-z0-9_]{1,64})/g)];
  for(const match of matches){
    const tag=String(match[2]||'').toLowerCase();
    if(!tag||seen.has('#'+tag)) continue;
    seen.add('#'+tag);
    existing.push({type:'Hashtag',name:'#'+tag,href:ROOT+'/hashtag/'+encodeURIComponent(tag)});
  }
  return existing;
}
function noteActivity(row:any){const id=str(row.uri),published=str(row.published_at)||new Date().toISOString(),actor=str(row.actor_uri);const object={'@context':AP,id,type:str(row.object_type)||'Note',attributedTo:actor,content:str(row.content),summary:str(row.summary)||undefined,published,updated:str(row.updated_at)||published,url:str(row.url)||id,to:[`${AP}#Public`],cc:actor?[`${actor}/followers`]:[],sensitive:!!row.sensitive,...(row.in_reply_to_uri?{inReplyTo:row.in_reply_to_uri}:{}),...(Array.isArray(row.attachments)&&row.attachments.length?{attachment:row.attachments}:{}),...(Array.isArray(row.tags)&&row.tags.length?{tag:row.tags}:{})};return {'@context':AP,id:`${id}/activity`,type:'Create',actor,published,to:object.to,cc:object.cc,object};}
function decodeCursor(v:string|null){if(!v)return null;try{return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v),c=>c.charCodeAt(0))))}catch{return null}}
function encodeCursor(v:any){return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v))));}
async function outbox(a:any,u:URL){
  const profile=await db.from('profiles').select('visibility,protected_account,account_status').eq('id',a.user_id).maybeSingle();
  if(profile.error)throw profile.error;
  const outboxId=`${a.actor_id}/outbox`;
  const limit=Math.min(Math.max(Number(u.searchParams.get('limit')||20),1),40);
  const firstUrl=`${outboxId}?page=true&limit=${limit}`;
  const isPublic=profile.data?.account_status==='active'&&profile.data?.visibility==='public'&&profile.data?.protected_account!==true;
  if(!isPublic){
    if(u.searchParams.get('page')==='true'){
      return json({'@context':AP,id:firstUrl,type:'OrderedCollectionPage',partOf:outboxId,totalItems:0,orderedItems:[]});
    }
    return json({'@context':AP,id:outboxId,type:'OrderedCollection',totalItems:0,first:{id:firstUrl,type:'OrderedCollectionPage'}});
  }
  // The collection document is requested before any page and is part of the
  // production federation health contract. An exact count scans every matching
  // post and can exceed the edge gateway's 30s timeout under production load.
  // ActivityStreams permits totalItems as an estimate; use PostgreSQL's planner
  // estimate so discovery stays bounded and the actual page remains authoritative.
  if(u.searchParams.get('page')!=='true'){
    const count=await db.from('posts').select('id',{count:'planned',head:true}).or(`author_id.eq.${a.user_id},user_id.eq.${a.user_id}`).is('deleted_at',null);
    if(count.error)throw count.error;
    return json({'@context':AP,id:outboxId,type:'OrderedCollection',totalItems:Number(count.count||0),first:{id:firstUrl,type:'OrderedCollectionPage'}});
  }
  const before=u.searchParams.get('before');
  let q=db.from('posts').select('id,author_id,user_id,content,created_at,updated_at,edited_at,quoted_post_id,deleted_at,image_url,video_url,is_video,media_urls').or(`author_id.eq.${a.user_id},user_id.eq.${a.user_id}`).is('deleted_at',null).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(limit+1);
  if(before)q=q.lt('created_at',before);
  const result=await q;
  if(result.error)throw result.error;
  const rows=result.data||[];
  const visible=rows.slice(0,limit);
  const items=visible.map((p:any)=>{
    const id=`${a.actor_id}/statuses/${p.id}`;
    const object:any={'@context':AP,id,type:'Note',attributedTo:a.actor_id,content:str(p.content),published:p.created_at,updated:p.edited_at||p.updated_at||p.created_at,url:id,to:[`${AP}#Public`],cc:[a.followers_url]};
    if(p.quoted_post_id)object.quote=`${a.actor_id}/statuses/${p.quoted_post_id}`;
    const rawUrls:string[]=Array.isArray(p.media_urls)?p.media_urls.map((item:any):string=>typeof item==='string'?item:uri(item)).filter((value:string)=>/^https:\/\//i.test(value)):[];
    if(!rawUrls.length&&/^https:\/\//i.test(str(p.video_url)))rawUrls.push(str(p.video_url));
    if(!rawUrls.length&&/^https:\/\//i.test(str(p.image_url)))rawUrls.push(str(p.image_url));
    const attachments=Array.from(new Set<string>(rawUrls)).map((url:string)=>({type:p.is_video||url===p.video_url?'Video':'Image',mediaType:p.is_video||url===p.video_url?'video/mp4':'image/*',url}));
    if(attachments.length)object.attachment=attachments;
    const tags=hashtagTags(p);
    if(tags.length)object.tag=tags;
    return {'@context':AP,id:`${id}/activity`,type:'Create',actor:a.actor_id,published:p.created_at,to:[`${AP}#Public`],cc:[a.followers_url],object};
  });
  const hasMore=rows.length>limit;
  const last=visible[visible.length-1] as any;
  const currentUrl=`${outboxId}?page=true&limit=${limit}${before?`&before=${encodeURIComponent(before)}`:''}`;
  const next=hasMore&&last?.created_at?`${outboxId}?page=true&limit=${limit}&before=${encodeURIComponent(String(last.created_at))}`:null;
  return json({'@context':AP,id:currentUrl,type:'OrderedCollectionPage',partOf:outboxId,orderedItems:items,...(next?{next}:{})});
}
async function collection(a:any,kind:string,u:URL){const profile=await db.from('profiles').select('visibility,protected_account,account_status').eq('id',a.user_id).maybeSingle();if(profile.error)throw profile.error;const collectionId=`${a.actor_url||a.uri}/${kind}`;if(profile.data?.account_status!=='active'||profile.data?.visibility!=='public'||profile.data?.protected_account===true)return json({'@context':AP,id:collectionId,type:'OrderedCollectionPage',partOf:collectionId,totalItems:0,orderedItems:[]});const relation=kind==='followers'?'follower':'following',limit=Math.min(Math.max(Number(u.searchParams.get('limit')||40),1),100),cursor=decodeCursor(u.searchParams.get('cursor'));let q=db.from('federated_follow_relationships').select('remote_actor_uri,created_at,id').eq('local_user_id',a.user_id).eq('direction',relation==='following'?'following':'follower').in('state',['accepted','active']).eq('delivery_state','delivered').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(limit+1);if(cursor?.created_at&&cursor?.id)q=q.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);const r=await q;if(r.error)throw r.error;const rows=r.data||[],has=rows.length>limit,items=rows.slice(0,limit).map((x:any)=>x.remote_actor_uri),last=rows[limit-1] as any;const next=has&&last?`${a.actor_url||a.uri}/${kind}?limit=${limit}&cursor=${encodeURIComponent(encodeCursor({created_at:last.created_at,id:last.id}))}`:null;return json({'@context':AP,id:collectionId,type:'OrderedCollectionPage',partOf:collectionId,orderedItems:items,...(next?{next}:{})});}
Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'content-type,accept,date,digest,signature,signature-input,content-digest,host'}});try{const u=new URL(req.url);const functionPrefix='/functions/v1/mastodon-federation';const path=u.pathname.startsWith(functionPrefix)?(u.pathname.slice(functionPrefix.length)||'/'):u.pathname;if(req.method==='POST'){const raw=await req.text();const r=await fetch(`${SUPABASE_URL}/functions/v1/federation-inbox`,{method:'POST',headers:req.headers,body:raw});return new Response(await r.text(),{status:r.status,headers:r.headers});}if(req.method!=='GET')return json({error:'GET or POST required'},405,{'Content-Type':'application/json'});const normalizedPath=path.replace(/\/+$/,'')||'/';const rawPath=u.pathname.replace(/\/+$/,'')||'/';if(normalizedPath==='/inbox'||/^\/users\/[^/]+\/inbox$/.test(normalizedPath)||rawPath===functionPrefix+'/inbox'||/^\/functions\/v1\/mastodon-federation\/users\/[^/]+\/inbox$/.test(rawPath))return json({error:'Method not allowed'},405,{'Content-Type':'application/json','Allow':'POST, OPTIONS'});if(path.endsWith('.well-known/webfinger')){const resource=u.searchParams.get('resource')||'',m=resource.match(/^acct:([^@]+)@([^@]+)$/i);if(!m)return json({error:'Invalid resource'},400,{'Content-Type':'application/jrd+json'});if(m[2].toLowerCase()!==new URL(ROOT).hostname.toLowerCase())return json({error:'Unknown host'},404,{'Content-Type':'application/jrd+json'});const username=decodeURIComponent(m[1]);// actor() performs the authoritative local-profile lookup and checks account_status.
// Do not query profiles here first: that duplicated a network round trip on every
// WebFinger request and made discovery especially fragile during DB contention.
const a=await actor(username);if(!a?.actor_id||!a.user_id||String(a.username||'').toLowerCase()!==username.toLowerCase())return json({error:'Actor not found'},404,{'Content-Type':'application/jrd+json'});const id=a.actor_id;return json({subject:`acct:${a.username}@${new URL(ROOT).hostname}`,aliases:[id],links:[{rel:'self',type:'application/activity+json',href:id},{rel:'http://webfinger.net/rel/profile-page',type:'text/html',href:id}]},200,{'Content-Type':'application/jrd+json; charset=utf-8'});}if(path.endsWith('/.well-known/nodeinfo'))return json({links:[{rel:'http://nodeinfo.diaspora.software/ns/schema/2.1',href:`${ROOT}/nodeinfo/2.1`},{rel:'http://nodeinfo.diaspora.software/ns/schema/2.0',href:`${ROOT}/nodeinfo/2.0`}]},200,{'Content-Type':'application/json','Cache-Control':'public, max-age=300, stale-while-revalidate=300','CDN-Cache-Control':'public, max-age=300'});if(path.endsWith('/nodeinfo/2.0')||path.endsWith('/nodeinfo/2.1')){const stats=await getNodeInfoStats();const version=path.endsWith('/2.1')?'2.1':'2.0';const body:any={version,software:{name:'testagram',version:'1.0.0'},protocols:['activitypub'],usage:{users:{total:stats.users,activeMonth:stats.users,activeHalfyear:stats.users},localPosts:stats.posts},openRegistrations:true,metadata:{}};if(version==='2.1')body.services={inbound:[],outbound:[]};return json(body,200,{'Content-Type':version==='2.1'?'application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"':'application/json','Cache-Control':'public, max-age=300, stale-while-revalidate=300','CDN-Cache-Control':'public, max-age=300'});}if(u.pathname.includes('/users/')){const tail=u.pathname.split('/users/')[1]||'';const parts=tail.split('/').filter(Boolean);const username=decodeURIComponent(parts[0]||'');const sub=parts[1]||'';if(username){const a=await actor(username);if(!a)return json({error:'Actor not found'},404,{'Content-Type':'application/json'});if(!sub)return json(actorJson(a));if(sub==='outbox')return outbox(a,u);if(sub==='followers'||sub==='following')return collection(a,sub,u);}}return json({error:'Not found'},404,{'Content-Type':'application/json'});}catch(e){console.error('[mastodon-federation]',e);return json({error:e instanceof Error?e.message:'Federation endpoint failed'},500,{'Content-Type':'application/json','Cache-Control':'no-store'});}});
