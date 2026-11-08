import { backendCapabilities } from '@/services/testagramCapabilityClient';
export type QuoteLikeItem={id:string;user_id:string;post_id:string;created_at:string;quote:any;profile:any};
export async function listQuoteLikes(sourcePostId:string,limit=50):Promise<QuoteLikeItem[]>{const result=await backendCapabilities.call<{items:QuoteLikeItem[]}>('testagram.posts.quote_likes.list',{post_id:sourcePostId,limit:Math.min(100,Math.max(1,limit))});return result.items??[];}
