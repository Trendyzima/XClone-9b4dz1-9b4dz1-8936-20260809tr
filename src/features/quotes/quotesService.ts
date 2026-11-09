import { socialApi } from '@/services/socialApiClient';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
export type QuoteItem={id:string;user_id:string;content:string;created_at:string;quoted_post_id:string;profile:any};
export async function quotePost(quotedPostId:string,content:string){return backendCapabilities.quotePost(quotedPostId,content);}
export async function listQuotes(postId:string,limit=50):Promise<QuoteItem[]>{const result=await socialApi.listPostInteractions(postId,'quotes',limit);return result.items as QuoteItem[];}
