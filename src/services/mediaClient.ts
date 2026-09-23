import { supabase, supabasePublishableKey, supabaseUrl } from '@/lib/supabase';
import { requireAccessToken } from '@/services/backendClient';

export type MediaCompleted = { media_id:string; object_key:string; mime_type:string; media_type:'image'|'video'|'audio'|'file'; status:string; media_url:string|null; etag?:string|null; size_bytes:number; public_url:string|null; };
export const MAX_TESTAGRAM_MEDIA_BYTES = 20 * 1024 * 1024;

function friendlyMediaError(error:unknown){
  const m=error instanceof Error?error.message:String(error??'');
  if(/Failed to fetch|NetworkError|Load failed|network|connection/i.test(m)) return 'Connection interrupted while uploading. Please try again.';
  if(/401|Authentication required|sign in again/i.test(m)) return 'Your session expired. Please sign in again.';
  if(/413|20 MiB|too large|FILE_TOO_LARGE/i.test(m)) return 'That file is too large. Maximum size is 20 MiB.';
  return m||'Media upload failed. Please try again.';
}

async function uploadAttempt(file:File,postId?:string|null,threadId?:string|null,accessTokenOverride?:string){
  const accessToken = accessTokenOverride ?? await requireAccessToken();
  const form=new FormData();
  form.append('file',file,file.name);
  if(postId) form.append('post_id',postId);
  if(threadId) form.append('thread_id',threadId);
  const response=await fetch(supabaseUrl+'/functions/v1/post-media-upload',{
    method:'POST',
    headers:{Authorization:'Bearer '+accessToken,apikey:supabasePublishableKey},
    body:form,
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload?.error||('Upload failed ('+response.status+')'));
  return payload as MediaCompleted;
}

export async function uploadTestagramMedia(file:File,postId?:string|null,threadId?:string|null,accessTokenOverride?:string):Promise<MediaCompleted>{
  try {
    if(file.size<=0) throw new Error('The selected file is empty.');
    if(file.size>MAX_TESTAGRAM_MEDIA_BYTES) throw new Error('That file is too large. Maximum size is 20 MiB.');
    let last:unknown=null;
    for(let attempt=0;attempt<3;attempt++){
      try { return await uploadAttempt(file,postId,threadId,accessTokenOverride); }
      catch(error){
        last=error;
        const message=error instanceof Error?error.message:String(error??'');
        if(!/Failed to fetch|NetworkError|Load failed|network|connection/i.test(message) || attempt===2) throw error;
        await new Promise(resolve=>setTimeout(resolve,750*(attempt+1)));
      }
    }
    throw last instanceof Error?last:new Error('Media upload failed.');
  } catch(error){ throw new Error(friendlyMediaError(error)); }
}

export async function attachTestagramMedia(mediaId:string,postId:string,accessTokenOverride?:string):Promise<void>{
  const accessToken = accessTokenOverride ?? await requireAccessToken();
  const normalizedMediaId=String(mediaId??'').trim();
  const normalizedPostId=String(postId??'').trim();
  if(!normalizedMediaId||!normalizedPostId) throw new Error('Media attachment could not start because the media or post ID was missing.');
  const response=await fetch('/api/media',{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},body:JSON.stringify({action:'attach',media_id:normalizedMediaId,media_asset_id:normalizedMediaId,post_id:normalizedPostId})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload?.error||('Media attach failed ('+response.status+')'));
}
export async function deleteTestagramMedia(mediaId:string,accessTokenOverride?:string):Promise<void>{
  let accessToken:string;
  try { accessToken = accessTokenOverride ?? await requireAccessToken(); } catch { return; }
  await fetch('/api/media',{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},body:JSON.stringify({action:'delete',media_id:mediaId})}).catch(()=>undefined);
}