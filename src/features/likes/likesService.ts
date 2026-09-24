import { supabase } from '@/lib/supabase';
import { backendCapabilities } from '@/services/backendClient';
export type LikeItem={id:string;user_id:string;post_id:string;created_at:string;profile:any};
export async function getLikeState(postId:string){return backendCapabilities.getLikeState(postId);}
export async function toggleLike(postId:string){return backendCapabilities.likePost(postId);}
export async function listLikes(postId:string,limit=50):Promise<LikeItem[]>{
 const {data,error}=await supabase.from('post_reactions').select('id,user_id,post_id,created_at').eq('post_id',postId).eq('emoji','❤️').order('created_at',{ascending:false}).limit(Math.min(100,Math.max(1,limit)));
 if(error)throw error; const rows=data??[]; const ids=rows.map((r:any)=>r.user_id); if(!ids.length)return [];
 const {data:profiles,error:profileError}=await supabase.from('profiles').select('id,username,display_name,avatar_url,verified').in('id',ids); if(profileError)throw profileError;
 const byId=new Map((profiles??[]).map((p:any)=>[p.id,p])); return rows.map((r:any)=>({...r,profile:byId.get(r.user_id)??null}));
}


export async function listProfileLikes(userId: string, limit = 50): Promise<any[]> {
  const size = Math.min(100, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 50));
  const { data, error } = await supabase
    .from('post_reactions')
    .select('id,user_id,post_id,created_at')
    .eq('user_id', userId)
    .eq('emoji', '❤️')
    .order('created_at', { ascending: false })
    .limit(size);
  if (error) throw error;

  const postIds = [...new Set((data ?? []).map((row: any) => row.post_id).filter(Boolean))];
  if (!postIds.length) return [];

  const { data: posts, error: postsError } = await supabase
    .from('posts')
    .select('*')
    .in('id', postIds)
    .is('deleted_at', null);
  if (postsError) throw postsError;

  const authorIds = [...new Set((posts ?? []).map((post: any) => post.author_id).filter(Boolean))];
  const { data: profiles, error: profilesError } = authorIds.length
    ? await supabase.from('profiles').select('id,username,display_name,full_name,avatar_url,verified').in('id', authorIds)
    : { data: [], error: null };
  if (profilesError) console.warn('[likes] profile enrichment failed', profilesError);
  const profileById = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));
  const byId = new Map((posts ?? []).map((post: any) => [post.id, { ...post, profiles: profileById.get(post.author_id) ?? null }]));
  return (data ?? []).map((row: any) => byId.get(row.post_id)).filter(Boolean);
}
