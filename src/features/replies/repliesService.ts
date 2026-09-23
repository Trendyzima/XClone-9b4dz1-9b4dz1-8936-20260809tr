import { backendCapabilities } from '@/services/backendClient';
import { supabase } from '@/lib/supabase';

export type ReplyItem = { id:string; user_id:string; post_id:string; content:string; created_at:string; updated_at:string; profile:any; };
export async function listReplies(postId:string, limit=50){ return backendCapabilities.listReplies(postId,limit); }
export async function createReply(postId:string, content:string){ return backendCapabilities.createReply(postId,content); }
export async function listProfileReplies(userId:string, limit=50):Promise<ReplyItem[]> {
  const { data,error } = await supabase.from('replies')
    .select('id,user_id,post_id,content,created_at,updated_at,posts!replies_post_id_fkey(id,content,author_id,created_at,profiles!posts_author_id_fkey(id,username,full_name,avatar_url,verified))')
    .eq('user_id',userId).order('created_at',{ascending:false}).limit(Math.min(100,Math.max(1,limit)));
  if(error) throw error;
  return (data??[]) as ReplyItem[];
}
