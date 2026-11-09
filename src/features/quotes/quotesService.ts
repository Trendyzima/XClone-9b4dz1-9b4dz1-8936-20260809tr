import { backendCapabilities } from '@/services/testagramCapabilityClient';
export type QuoteItem={id:string;user_id:string;content:string;created_at:string;quoted_post_id:string;profile:any};
export async function quotePost(quotedPostId:string,content:string){return backendCapabilities.quotePost(quotedPostId,content);}
export async function listQuotes(postId:string,limit=50):Promise<QuoteItem[]>{const result=await backendCapabilities.call<{items:QuoteItem[]}>('testagram.posts.quotes.list',{post_id:postId,limit:Math.min(100,Math.max(1,limit))});return result.items??[];}
