import { supabase } from '@/lib/supabase';
import { backendCapabilities } from '@/services/backendClient';

export type LikeItem = { id:string; user_id:string; post_id:string; created_at:string; profile:any };
export async function getLikeState(postId:string){ return backendCapabilities.getLikeState(postId); }
export async function toggleLike(postId:string){ return backendCapabilities.likePost(postId); }
export async function listLikes(postId:string, limit=50):Promise<LikeItem[]> {
  const { data, error } = await supabase.from('post_reactions')
    .select('id,user_id,post_id,created_at,profiles:user_id(id,username,display_name,avatar_url,verified)')
    .eq('post_id',postId).eq('emoji','❤️').order('created_at',{ascending:false}).limit(Math.min(100,Math.max(1,limit)));
  if(error) throw error;
  return (data??[]) as LikeItem[];
}
