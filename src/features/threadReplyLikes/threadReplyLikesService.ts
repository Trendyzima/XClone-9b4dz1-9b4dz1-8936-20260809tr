import { backendCapabilities } from '@/services/testagramCapabilityClient';
export async function listThreadReplyLikes(replyId:string,limit=50){const result=await backendCapabilities.call<{items:any[]}>('testagram.threads.reply_likes.list',{reply_id:replyId,limit:Math.min(100,Math.max(1,limit))});return result.items??[];}
export async function toggleThreadReplyLike(replyId:string,_userId?:string){const result=await backendCapabilities.call<{liked:boolean}>('testagram.threads.reply_likes.toggle',{reply_id:replyId});return Boolean(result.liked);}
