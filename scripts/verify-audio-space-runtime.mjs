import { createClient } from '@supabase/supabase-js';

const url=process.env.VITE_SUPABASE_URL; const key=process.env.VITE_SUPABASE_ANON_KEY;
const aEmail=process.env.AUDIO_SPACE_TEST_A_EMAIL; const aPassword=process.env.AUDIO_SPACE_TEST_A_PASSWORD;
const bEmail=process.env.AUDIO_SPACE_TEST_B_EMAIL; const bPassword=process.env.AUDIO_SPACE_TEST_B_PASSWORD;
const forensicKey=process.env.AUDIO_SPACE_TEST_FORENSIC_KEY;
if(!url||!key||!aEmail||!aPassword||!bEmail||!bPassword||!forensicKey) throw new Error('MISSING_REQUIRED_SECRET');
const mk=()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const a=mk(), b=mk();
async function signIn(c,email,password){const {data,error}=await c.auth.signInWithPassword({email,password});if(error||!data.session) throw error||new Error('AUTH_FAILED');return data.user.id;}
function decode(jwt){return JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString('utf8'));}
const host=await signIn(a,aEmail,aPassword); const guest=await signIn(b,bEmail,bPassword);
const {data:space,error:createErr}=await a.rpc('create_audio_space',{p_title:'CI Audio Space forensic '+Date.now(),p_description:'automated acceptance',p_topic:'ci',p_visibility:'public',p_category:'technology',p_language:'en',p_scheduled_for:null,p_max_audience:10,p_recording_enabled:false,p_listener_requests_enabled:true});
if(createErr||!space?.id) throw createErr||new Error('CREATE_FAILED'); const sid=space.id;
const must=async(p,c)=>{const {error}=await p;if(error)throw error;};
await must(a.rpc('start_audio_space',{p_space_id:sid})); await must(b.rpc('join_audio_space',{p_space_id:sid}));
const {data:req,error:reqErr}=await b.rpc('request_audio_space_speak',{p_space_id:sid}); if(reqErr||!req?.id) throw reqErr||new Error('REQUEST_FAILED');
await must(a.rpc('resolve_audio_space_speak_request',{p_request_id:req.id,p_approve:true}));
const {data:cap,error:capErr}=await b.rpc('get_audio_space_capability',{p_space_id:sid}); if(capErr||!cap?.[0]?.can_publish) throw capErr||new Error('CAPABILITY_PUBLISH_FAILED');
const tokenResp=await b.functions.invoke('livekit-space-token',{body:{space_id:sid}}); if(tokenResp.error||!tokenResp.data?.ok) throw tokenResp.error||new Error('SPACE_TOKEN_FAILED');
const claims=decode(tokenResp.data.data.token); if(claims.video?.canPublish!==true||claims.video?.canSubscribe!==true||claims.video?.room!==tokenResp.data.data.room_name) throw new Error('TOKEN_CAPABILITY_ASSERT_FAILED');
await must(a.rpc('mute_audio_space_participant',{p_space_id:sid,p_target_user_id:guest,p_muted:true}));
const mutedResp=await b.functions.invoke('livekit-space-token',{body:{space_id:sid}}); if(mutedResp.error||!mutedResp.data?.ok) throw mutedResp.error||new Error('MUTED_TOKEN_CALL_FAILED'); const mutedClaims=decode(mutedResp.data.data.token); if(mutedClaims.video?.canPublish!==false) throw new Error('MUTED_TOKEN_PUBLISH_ASSERT_FAILED');
await must(a.rpc('ban_audio_space_participant',{p_space_id:sid,p_target_user_id:guest}));
const bannedResp=await b.functions.invoke('livekit-space-token',{body:{space_id:sid}}); if(!bannedResp.error && bannedResp.data?.ok) throw new Error('BANNED_TOKEN_WAS_ISSUED');
await must(a.rpc('end_audio_space',{p_space_id:sid}));
console.log(JSON.stringify({ok:true,space_id:sid,checks:['create','start','join','speak-request','approve','speaker-capability','livekit-token-publish','mute-token-no-publish','ban-token-denied','end'],forensic_key_used:Boolean(forensicKey)}));
