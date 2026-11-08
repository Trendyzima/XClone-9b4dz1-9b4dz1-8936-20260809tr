import { backendCapabilities } from '@/services/testagramCapabilityClient';
export async function listThreadQuoteLikes(quoteId:string,limit=50){const result=await backendCapabilities.call<{items:any[]}>('testagram.threads.quote_likes.list',{quote_id:quoteId,limit:Math.min(100,Math.max(1,limit))});return result.items??[];}
export async function toggleThreadQuoteLike(quoteId:string,_userId?:string){const result=await backendCapabilities.call<{liked:boolean}>('testagram.threads.quote_likes.toggle',{quote_id:quoteId});return Boolean(result.liked);}
