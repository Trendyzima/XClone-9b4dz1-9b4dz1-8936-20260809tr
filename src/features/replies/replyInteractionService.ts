import { backendCapabilities } from '@/services/testagramCapabilityClient';
import * as federationApi from '@/api/federation';
import { togglePostLike, togglePostRepost } from '@/services/postInteractionService';

export type ReplyEngagement = { likes:number; reposts:number; bookmarks:number; shares:number; replies:number; quotes:number; reaction_total:number; is_liked:boolean; is_reposted:boolean; is_bookmarked:boolean; user_reactions:string[] };
const isRemote = (id:string) => /^https:\/\//i.test(id);
const empty = ():ReplyEngagement => ({likes:0,reposts:0,bookmarks:0,shares:0,replies:0,quotes:0,reaction_total:0,is_liked:false,is_reposted:false,is_bookmarked:false,user_reactions:[]});

export async function getReplyEngagement(replyId:string):Promise<ReplyEngagement>{
 if(isRemote(replyId)){const [counts,state,reactions]=await Promise.all([federationApi.getInteractionCounts(replyId),federationApi.getInteractionState(replyId),federationApi.getReactionState(replyId)]);return {...empty(),...counts,is_liked:Boolean(state.like),is_reposted:Boolean(state.repost),user_reactions:reactions.emojis??[],reaction_total:(reactions.emojis??[]).length};}
 return backendCapabilities.call<ReplyEngagement>('testagram.replies.engagement.get',{reply_id:replyId});
}
async function toggle(capability:string,replyId:string){return backendCapabilities.call<{active:boolean;count:number}>(capability,{reply_id:replyId});}
export const toggleReplyLike=async(id:string)=>isRemote(id)?(async()=>{const before=await getReplyEngagement(id);const next=await togglePostLike(id,before.is_liked);return {active:next.is_liked,count:next.likes_count};})():toggle('testagram.replies.likes.toggle',id);
export const toggleReplyRepost=async(id:string)=>isRemote(id)?(async()=>{const before=await getReplyEngagement(id);const next=await togglePostRepost(id,before.is_reposted);return {active:next.is_reposted,count:next.reposts_count};})():toggle('testagram.replies.reposts.toggle',id);
export const toggleReplyBookmark=(id:string)=>toggle('testagram.replies.bookmarks.toggle',id);
export async function recordReplyShare(id:string){if(isRemote(id)){const result=await federationApi.recordShare(id);return Number(result.shares??0);}const result=await backendCapabilities.call<{count:number}>('testagram.replies.shares.record',{reply_id:id});return Number(result.count??0);}
export async function toggleReplyReaction(id:string,emoji:string){if(isRemote(id)){const state=await federationApi.getReactionState(id);const active=!(state.emojis??[]).includes(emoji);await federationApi.setReaction(id,emoji,active);return {active,count:active?1:0};}return backendCapabilities.call<{active:boolean;count:number}>('testagram.replies.reactions.toggle',{reply_id:id,emoji});}
export async function createReplyQuote(id:string,content:string){if(isRemote(id))return federationApi.reply({postId:id,content});return backendCapabilities.call('testagram.replies.quotes.create',{reply_id:id,content});}
