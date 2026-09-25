import { supabase } from '@/lib/supabase';

export type ReplyEngagement = { likes:number; reposts:number; bookmarks:number; shares:number; replies:number; is_liked:boolean; is_reposted:boolean; is_bookmarked:boolean };

export async function getReplyEngagement(replyId:string):Promise<ReplyEngagement>{
 const {data,error}=await supabase.rpc('testagram_reply_engagement',{p_reply_id:replyId});
 if(error) throw error;
 return {likes:Number(data?.likes??0),reposts:Number(data?.reposts??0),bookmarks:Number(data?.bookmarks??0),shares:Number(data?.shares??0),replies:Number(data?.replies??0),is_liked:Boolean(data?.is_liked),is_reposted:Boolean(data?.is_reposted),is_bookmarked:Boolean(data?.is_bookmarked)};
}
async function toggle(name:string,replyId:string){const {data,error}=await supabase.rpc(name,{p_reply_id:replyId});if(error)throw error;return {active:Boolean(data?.active),count:Number(data?.count??0)};}
export const toggleReplyLike=(id:string)=>toggle('testagram_toggle_reply_like',id);
export const toggleReplyRepost=(id:string)=>toggle('testagram_toggle_reply_repost',id);
export const toggleReplyBookmark=(id:string)=>toggle('testagram_toggle_reply_bookmark',id);
export async function recordReplyShare(id:string){const {data,error}=await supabase.rpc('testagram_record_reply_share',{p_reply_id:id});if(error)throw error;return Number(data?.count??0);}
