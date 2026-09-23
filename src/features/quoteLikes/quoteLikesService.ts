import { supabase } from '@/lib/supabase';
export type QuoteLikeItem={id:string;user_id:string;post_id:string;created_at:string;quote:any;profile:any};
export async function listQuoteLikes(sourcePostId:string,limit=50):Promise<QuoteLikeItem[]>{
 const {data,error}=await supabase.from('post_reactions').select('id,user_id,post_id,created_at,profiles:user_id(id,username,display_name,avatar_url,verified),quote:posts!post_reactions_post_id_fkey(id,user_id,content,created_at,quoted_post_id)').eq('emoji','❤️').eq('quote.quoted_post_id',sourcePostId).order('created_at',{ascending:false}).limit(Math.min(100,Math.max(1,limit)));
 if(error)throw error; return (data??[]) as QuoteLikeItem[];
}
