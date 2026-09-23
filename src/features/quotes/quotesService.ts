import { supabase } from '@/lib/supabase';
import { backendCapabilities } from '@/services/backendClient';
export type QuoteItem={id:string;user_id:string;content:string;created_at:string;quoted_post_id:string;profile:any};
export async function quotePost(quotedPostId:string,content:string){return backendCapabilities.quotePost(quotedPostId,content);}
export async function listQuotes(postId:string,limit=50):Promise<QuoteItem[]>{
 const {data,error}=await supabase.from('posts').select('id,user_id,content,created_at,quoted_post_id,profiles:user_id(id,username,display_name,avatar_url,verified)').eq('quoted_post_id',postId).is('deleted_at',null).order('created_at',{ascending:false}).limit(Math.min(100,Math.max(1,limit)));
 if(error)throw error; return (data??[]) as QuoteItem[];
}
