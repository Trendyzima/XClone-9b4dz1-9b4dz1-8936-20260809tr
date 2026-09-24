import { supabase } from '@/lib/supabase';
export type QuoteLikeItem={id:string;user_id:string;post_id:string;created_at:string;quote:any;profile:any};
export async function listQuoteLikes(sourcePostId:string,limit=50):Promise<QuoteLikeItem[]>{
 const {data,error}=await supabase.from('post_reactions').select('id,user_id,post_id,created_at,quote:posts!post_reactions_post_id_fkey!inner(id,user_id,author_id,content,created_at,quoted_post_id)').eq('emoji','❤️').eq('quote.quoted_post_id',sourcePostId).order('created_at',{ascending:false}).limit(Math.min(100,Math.max(1,limit)));
 if(error)throw error; const rows=data??[]; const ids=[...new Set(rows.map((r:any)=>r.user_id))]; if(!ids.length)return [];
 const {data:profiles,error:profileError}=await supabase.from('profiles').select('id,username,display_name,avatar_url,verified').in('id',ids); if(profileError)console.warn('[quotes] profile enrichment failed',profileError);
 const byId=new Map((profiles??[]).map((p:any)=>[p.id,p])); return rows.map((r:any)=>({...r,profile:byId.get(r.user_id)??null}));
}
