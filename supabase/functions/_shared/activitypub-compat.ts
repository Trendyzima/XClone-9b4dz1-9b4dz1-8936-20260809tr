import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
type J = Record<string, unknown>;
const s=(v:unknown)=>typeof v==='string'?v:'';
const uri=(v:unknown)=>typeof v==='string'?v:v&&typeof v==='object'?s((v as J).id):'';
const obj=(v:unknown):J=>v&&typeof v==='object'?v as J:{};
const CONTEXT=['https://www.w3.org/ns/activitystreams','https://w3id.org/security/v1','https://w3id.org/fep/044f'];

async function remoteActor(db:SupabaseClient, actor:string, hint?:unknown){
  if(!actor.startsWith('https://')) return;
  const a=obj(hint), end=obj(a.endpoints), u=new URL(actor);
  const common={actor_url:actor,acct:s(a.preferredUsername)?`${s(a.preferredUsername)}@${u.hostname}`:null,username:s(a.preferredUsername)||null,domain:u.hostname,inbox_url:uri(a.inbox)||null,shared_inbox_url:uri(end.sharedInbox)||null,actor:Object.keys(a).length?a:null,fetched_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const rr=await db.from('federation_remote_actors').upsert(common,{onConflict:'actor_url'}); if(rr.error&&!/column|relation|does not exist/i.test(rr.error.message)) throw rr.error;
  const old=await db.from('federated_actors').select('id').eq('uri',actor).maybeSingle(); if(old.error) throw old.error;
  const values={uri:actor,preferred_username:s(a.preferredUsername)||null,display_name:s(a.name)||s(a.preferredUsername)||null,summary:s(a.summary)||null,avatar_url:uri(a.icon)||null,header_url:uri(a.image)||null,actor_type:s(a.type)||'Person',inbox_url:uri(a.inbox)||null,shared_inbox_url:uri(end.sharedInbox)||null,outbox_url:uri(a.outbox)||null,followers_url:uri(a.followers)||null,following_url:uri(a.following)||null,public_key_id:s(obj(a.publicKey).id)||null,public_key_pem:s(obj(a.publicKey).publicKeyPem)||null,raw_actor:Object.keys(a).length?a:{},fetched_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const r=old.data?await db.from('federated_actors').update(values).eq('id',old.data.id):await db.from('federated_actors').insert(values); if(r.error) throw r.error;
}
async function object(db:SupabaseClient,value:unknown,actor:string){
  const o=obj(value),id=uri(value); if(!id.startsWith('https://')) return;
  const r=await db.from('federated_objects').upsert({uri:id,object_type:s(o.type)||'Object',actor_uri:actor,url:uri(o.url)||id,content:s(o.content)||null,summary:s(o.summary)||null,published_at:s(o.published)||null,updated_at:s(o.updated)||null,sensitive:Boolean(o.sensitive),in_reply_to_uri:uri(o.inReplyTo)||null,quote_uri:uri(o.quote)||null,language_code:s(o.language)||null,attachments:Array.isArray(o.attachment)?o.attachment:[],tags:Array.isArray(o.tag)?o.tag:[],raw_object:o},{onConflict:'uri'}); if(r.error) throw r.error;
}
async function localActor(db:SupabaseClient,actor:string){
  const r=await db.from('activitypub_actors').select('user_id,actor_id').eq('actor_id',actor).maybeSingle();
  if(r.error)throw r.error;
  if(r.data)return {user_id:r.data.user_id,actor_url:r.data.actor_id};
  const username=decodeURIComponent(actor.split('/').filter(Boolean).pop()||'');
  const p=await db.from('profiles').select('id,username').eq('username',username).maybeSingle();
  if(p.data)return {user_id:p.data.id,actor_url:actor};
  return null;
}
async function rel(db:SupabaseClient,user:string,remote:string,kind:string,state:string){const r=await db.from('federated_relationships').upsert({local_user_id:user,remote_actor_uri:remote,relationship:kind,state,updated_at:new Date().toISOString()},{onConflict:'local_user_id,remote_actor_uri,relationship'});if(r.error)throw r.error;}
async function notify(db:SupabaseClient,user:string,actor:string,kind:string){const a=await db.from('federated_actors').select('id').eq('uri',actor).maybeSingle();if(a.error)throw a.error;if(!a.data)return;const r=await db.from('notifications').insert({recipient_id:user,actor_id:a.data.id,kind});if(r.error&&!/column|relation|does not exist/i.test(r.error.message))throw r.error;}
async function remoteInbox(db:SupabaseClient,actor:string){const r=await db.from('federation_remote_actors').select('inbox_url,shared_inbox_url').eq('actor_url',actor).maybeSingle();if(r.error)throw r.error;return r.data?.shared_inbox_url||r.data?.inbox_url||null;}
async function queue(db:SupabaseClient,activity:J,inbox:string){const now=new Date().toISOString();const a=await db.from('federated_activities').upsert({uri:s(activity.id),activity_type:s(activity.type),actor_uri:s(activity.actor),object_uri:uri(activity.object)||null,target_uri:uri(activity.target)||null,raw_activity:activity,received_at:now,processed_at:now,processing_state:'processed',processing_attempts:0},{onConflict:'uri'}).select('id').single();if(a.error)throw a.error;const d=await db.from('federation_deliveries').upsert({activity_id:a.data.id,target_inbox:inbox,instance_domain:new URL(inbox).hostname,status:'pending',attempt_count:0,next_attempt_at:now,activity_payload:activity},{onConflict:'activity_id,target_inbox'});if(d.error)throw d.error;}
async function objectOwner(db:SupabaseClient,objectUri:string){const r=await db.from('federated_objects').select('actor_uri').eq('uri',objectUri).maybeSingle();if(r.error)throw r.error;if(!r.data?.actor_uri)return null;return localActor(db,r.data.actor_uri);}
export async function processActivityCompat(db:SupabaseClient,activity:J,actor:string){
  const type=s(activity.type);if(!type)throw Error('ActivityPub activity type is required');if(uri(activity.actor)&&uri(activity.actor)!==actor)throw Error('Activity actor mismatch');
  await remoteActor(db,actor,activity.actor);
  if(['Create','Announce'].includes(type)&&uri(activity.object))await object(db,activity.object,actor);
  if(type==='Follow'){const target=uri(activity.object),local=target?await localActor(db,target):null;if(local?.user_id){await rel(db,local.user_id,actor,'follower','accepted');await notify(db,local.user_id,actor,'follow');const inbox=await remoteInbox(db,actor);if(inbox){const accept={"@context":CONTEXT,id:`${local.actor_url}/activities/${crypto.randomUUID()}`,type:'Accept',actor:local.actor_url,object:activity,to:[actor]};await queue(db,accept,inbox);}}return;}
  if(type==='Undo'){const f=obj(activity.object),t=s(f.type),target=uri(f.object);const local=target?await localActor(db,target):null;if(local?.user_id&&t==='Follow')await rel(db,local.user_id,actor,'follower','removed');if(t==='Like'||t==='Announce')await db.from('federation_remote_interactions').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('activity_uri',s(f.id)).eq('remote_actor_url',actor);return;}
  if(type==='Block'){const target=uri(activity.object),local=target?await localActor(db,target):null;if(local?.user_id){await rel(db,local.user_id,actor,'blocked','active');await notify(db,local.user_id,actor,'block');}return;}
  if(type==='Accept'||type==='Reject'){const f=obj(activity.object);if(s(f.type)==='Follow'){const local=await localActor(db,uri(f.actor));const remote=uri(f.object);if(local?.user_id&&remote)await rel(db,local.user_id,remote,'following',type==='Accept'?'accepted':'rejected');}return;}
  if(type==='Delete'){const target=uri(activity.object)||s(activity.object);if(target){const r=await db.from('federated_objects').update({deleted_at:new Date().toISOString(),tombstone:true}).eq('uri',target).eq('actor_uri',actor);if(r.error)throw r.error;}return;}
  if(type==='Update'){const o=obj(activity.object),id=uri(o);if(id===actor){await remoteActor(db,actor,o);return;}if(id)await object(db,o,actor);return;}
  if(type==='Like'||type==='Announce'){const target=uri(activity.object),local=target?await objectOwner(db,target):null;if(target){const r=await db.from('federation_remote_interactions').upsert({id:crypto.randomUUID(),local_user_id:local?.user_id||null,object_url:target,remote_actor_url:actor,activity_uri:s(activity.id),interaction_type:type==='Like'?'like':'repost',target_inbox:'',status:'active',payload:activity,expires_at:new Date(Date.now()+31536000000).toISOString()},{onConflict:'activity_uri'});if(r.error&&!/column|relation|does not exist/i.test(r.error.message))throw r.error;if(local?.user_id)await notify(db,local.user_id,actor,type==='Like'?'like':'repost');}return;}
}
