import { freshMediaApi } from '@/services/freshMediaApi';
import { backendCapabilities } from '@/services/testagramCapabilityClient';

export type MediaCompleted = { media_id:string; object_key:string; mime_type:string; media_type:'image'|'video'|'audio'|'file'; status:string; media_url:string|null; etag?:string|null; size_bytes:number; public_url:string|null; };
export const MAX_TESTAGRAM_MEDIA_BYTES = 20 * 1024 * 1024;

function friendlyMediaError(error:unknown){
  const m=error instanceof Error?error.message:String(error??'');
  if(/Failed to fetch|NetworkError|Load failed|network|connection/i.test(m)) return 'Connection interrupted while uploading. Please try again.';
  if(/401|Authentication required|sign in again/i.test(m)) return 'Your session expired. Please sign in again.';
  if(/413|20 MiB|too large|FILE_TOO_LARGE/i.test(m)) return 'That file is too large. Maximum size is 20 MiB.';
  return m||'Media upload failed. Please try again.';
}

async function uploadAttempt(file: File, postId?: string | null, threadId?: string | null, _accessTokenOverride?: string) {
  const result = await freshMediaApi.upload(file);
  if (postId || threadId) {
    await backendCapabilities.call('testagram.media.attach', {
      media_id: result.objectId,
      ...(postId ? { post_id: postId } : {}),
      ...(threadId ? { thread_id: threadId } : {}),
    });
  }
  return {
    media_id: result.objectId,
    object_key: result.objectId,
    mime_type: file.type || 'application/octet-stream',
    media_type: file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'file',
    status: 'protected',
    media_url: null,
    public_url: null,
    size_bytes: file.size,
  } as MediaCompleted;
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

export async function attachTestagramMedia(mediaId: string, postId: string, _accessTokenOverride?: string): Promise<void> {
  await backendCapabilities.call('testagram.media.attach', { media_id: mediaId, post_id: postId });
}
export async function deleteTestagramMedia(mediaId: string, _accessTokenOverride?: string): Promise<void> {
  await backendCapabilities.call('testagram.media.delete', { media_id: mediaId });
}
