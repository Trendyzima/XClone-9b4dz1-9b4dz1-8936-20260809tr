import { backendCapabilities } from '@/services/testagramCapabilityClient';
import * as federation from '@/api/federation';
export type ReplyItem={id:string;user_id:string;post_id:string;content:string;created_at:string;updated_at:string;parent_reply_id?:string|null;profile:any};
const boundedLimit=(n=50)=>Math.min(100,Math.max(1,Number.isFinite(n)?Math.floor(n):50));
export async function listReplies(postId:string,limit=50):Promise<{items:ReplyItem[];next_cursor:string|null}>{
 if(/^https:\/\//i.test(postId)){const items=await federation.getFederatedReplies(postId);return {items:items.slice(0,boundedLimit(limit)) as ReplyItem[],next_cursor:null};}
 return backendCapabilities.listReplies(postId,boundedLimit(limit));
}
export async function createReply(postId:string,content:string,parentReplyId?:string){return /^https:\/\//i.test(postId)?federation.reply({postId,content,parentReplyId}):backendCapabilities.createReply(postId,content,parentReplyId);}
export async function getReplyChain(replyId:string,limit=100):Promise<ReplyItem[]>{const result=await backendCapabilities.call<{items:ReplyItem[]}>('testagram.replies.chain',{reply_id:replyId,limit:Math.min(500,Math.max(1,Math.floor(limit)))});return result.items??[];}
export async function listProfileReplies(userId:string,limit=50):Promise<ReplyItem[]>{const result=await backendCapabilities.call<{items:ReplyItem[]}>('testagram.profile.replies.list',{user_id:userId,limit:boundedLimit(limit)});return result.items??[];}
export type ProfileRepliesPage={items:ReplyItem[];next_cursor:string|null};
export async function listProfileRepliesPage(userId:string,limit=20,cursor?:string|null):Promise<ProfileRepliesPage>{return backendCapabilities.call<ProfileRepliesPage>('testagram.profile.replies.list',{user_id:userId,limit:boundedLimit(limit),...(cursor?{cursor}:{})});}
