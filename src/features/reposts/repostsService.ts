import { supabase } from '@/lib/supabase';
import { backendCapabilities } from '@/services/backendClient';
export type RepostItem={id:string;user_id:string;post_id:string;created_at:string;profile:any};
export async function getRepostState(postId:string){return backendCapabilities.getRepostState(postId);}
export async function toggleRepost(postId:string){return backendCapabilities.repostPost(postId);}
export async function listReposts(postId:string,limit=50):Promise<RepostItem[]>{
 const {data,error}=await supabase.from('reposts').select('id,user_id,post_id,created_at').eq('post_id',postId).order('created_at',{ascending:false}).limit(Math.min(100,Math.max(1,limit)));
 if(error)throw error; const rows=data??[]; const ids=rows.map((r:any)=>r.user_id); if(!ids.length)return [];
 const {data:profiles,error:profileError}=await supabase.from('profiles').select('id,username,display_name,avatar_url,verified').in('id',ids); if(profileError)throw profileError;
 const byId=new Map((profiles??[]).map((p:any)=>[p.id,p])); return rows.map((r:any)=>({...r,profile:byId.get(r.user_id)??null}));
}
