import { socialApi } from '@/services/socialApiClient';
export type QuoteLikeItem={id:string;user_id:string;post_id:string;created_at:string;quote:any;profile:any};
export async function listQuoteLikes(sourcePostId:string,limit=50):Promise<QuoteLikeItem[]>{const result=await socialApi.listPostInteractions(sourcePostId,'quote-likes',limit);return result.items as QuoteLikeItem[];}
