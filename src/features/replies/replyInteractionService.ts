import { supabase } from '@/lib/supabase';
import { togglePostLike, togglePostRepost } from '@/services/postInteractionService';

export type ReplyEngagement = { likes:number; reposts:number; bookmarks:number; shares:number; replies:number; quotes:number; reaction_total:number; is_liked:boolean; is_reposted:boolean; is_bookmarked:boolean; user_reactions:string[] };

export async function getReplyEngagement(replyId:string):Promise<ReplyEngagement>{
 if(/^https:\/\//i.test(replyId)){
   const [{data:countsData,error:countsError},{data:stateData,error:stateError},{data:reactionData,error:reactionError}]=await Promise.all([
     supabase.functions.invoke('testagram-api',{body:{path:'/interaction-counts',method:'GET',params:{object_uri:replyId}}}),
     supabase.functions.invoke('testagram-api',{body:{path:'/federated-interaction-state',method:'GET',params:{object_uri:replyId}}}),
     supabase.functions.invoke('testagram-api',{body:{path:'/federated-reaction-state',method:'GET',params:{object_uri:replyId}}}),
   ]);
   if(countsError) throw countsError;
   const reactions=Array.isArray(reactionData?.emojis)?reactionData.emojis.filter((x:unknown):x is string=>typeof x==='string'):[];
   if(stateError) console.warn('[reply-interaction] remote state unavailable',stateError);
   if(reactionError) console.warn('[reply-interaction] remote reaction state unavailable',reactionError);
   return {
     likes:Number(countsData?.likes??0),
     reposts:Number(countsData?.reposts??0),
     bookmarks:Number(countsData?.bookmarks??0),
     shares:Number(countsData?.shares??0),
     replies:Number(countsData?.replies??0),
     quotes:Number(countsData?.quotes??0),
     reaction_total:reactions.length,
     is_liked:Boolean(stateData?.like),
     is_reposted:Boolean(stateData?.repost),
     is_bookmarked:Boolean(countsData?.is_bookmarked),
     user_reactions:reactions,
   };
 }
 const {data,error}=await supabase.rpc('testagram_reply_engagement',{p_reply_id:replyId});
 if(error) throw error;
 return {likes:Number(data?.likes??0),reposts:Number(data?.reposts??0),bookmarks:Number(data?.bookmarks??0),shares:Number(data?.shares??0),replies:Number(data?.replies??0),quotes:Number(data?.quotes??0),reaction_total:Number(data?.reaction_total??0),is_liked:Boolean(data?.is_liked),is_reposted:Boolean(data?.is_reposted),is_bookmarked:Boolean(data?.is_bookmarked),user_reactions:Array.isArray(data?.user_reactions)?data.user_reactions.filter((x:unknown):x is string=>typeof x==='string'):[]};
}
async function toggle(name:string,replyId:string){
 if(/^https:\/\//i.test(replyId)){
   if(name==='testagram_toggle_reply_bookmark'){
     const before=await getReplyEngagement(replyId);
     const path=before.is_bookmarked?'unbookmark':'bookmark';
     const { data, error } = await supabase.functions.invoke('testagram-api',{body:{path,method:'POST',body:{post_id:replyId}}});
     if(error) throw error; if(data?.error) throw new Error(String(data.error));
     return {active:!before.is_bookmarked,count:Math.max(0,before.bookmarks+(before.is_bookmarked?-1:1))};
   }
   if(name==='testagram_toggle_reply_share'){
     const { data, error } = await supabase.functions.invoke('testagram-api',{body:{path:'federated-reply-share',method:'POST',body:{object_uri:replyId}}});
     if(error) throw error; if(data?.error) throw new Error(String(data.error));
     return {active:true,count:Number(data?.shares??0)};
   }
   if(name==='testagram_toggle_reply_like'){
     const before=await getReplyEngagement(replyId); const result=await togglePostLike(replyId,before.is_liked);
     return {active:Boolean(result.is_liked),count:Number(result.likes_count??0)};
   }
   if(name==='testagram_toggle_reply_repost'){
     const before=await getReplyEngagement(replyId); const result=await togglePostRepost(replyId,before.is_reposted);
     return {active:Boolean(result.is_reposted),count:Number(result.reposts_count??0)};
   }
 }
 const {data,error}=await supabase.rpc(name,{p_reply_id:replyId});if(error)throw error;return {active:Boolean(data?.active),count:Number(data?.count??0)};
}
export const toggleReplyLike=(id:string)=>toggle('testagram_toggle_reply_like',id);
export const toggleReplyRepost=(id:string)=>toggle('testagram_toggle_reply_repost',id);
export const toggleReplyBookmark=(id:string)=>toggle('testagram_toggle_reply_bookmark',id);
export async function recordReplyShare(id:string){
 if(/^https:\/\//i.test(id)){
   const {data,error}=await supabase.functions.invoke('testagram-api',{body:{path:'federated-reply-share',method:'POST',body:{object_uri:id}}});
   if(error)throw error; if(data?.error)throw new Error(String(data.error)); return Number(data?.shares??0);
 }
 const {data,error}=await supabase.rpc('testagram_record_reply_share',{p_reply_id:id});if(error)throw error;return Number(data?.count??0);
}
export async function toggleReplyReaction(id:string,emoji:string){
 if(/^https:\/\//i.test(id)){
   const current=await getReplyEngagement(id); const active=!current.user_reactions.includes(emoji);
   const {data,error}=await supabase.functions.invoke('testagram-api',{body:{path:'federated/reactions',method:'POST',body:{post_id:id,emoji,enabled:active}}});
   if(error)throw error; if(data?.error)throw new Error(String(data.error));
   return {active,count:Number(data?.count??0)};
 }
 const {data,error}=await supabase.rpc('testagram_toggle_reply_reaction',{p_reply_id:id,p_emoji:emoji});if(error)throw error;return {active:Boolean(data?.active),count:Number(data?.count??0)};
}
export async function createReplyQuote(id:string,content:string){
 if(/^https:\/\//i.test(id)){
   const {data,error}=await supabase.functions.invoke('testagram-api',{body:{path:'/quote',method:'POST',body:{post_id:id,content}}});
   if(error) throw error;
   if(data?.error) throw new Error(String(data.error));
   return data;
 }
 const {data,error}=await supabase.rpc('testagram_create_reply_quote',{p_reply_id:id,p_content:content});if(error)throw error;return data;
}
