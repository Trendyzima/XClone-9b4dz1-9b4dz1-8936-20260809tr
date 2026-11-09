import { backendCapabilities } from '@/services/testagramCapabilityClient';
export async function listThreadQuotes(threadId:string,limit=50){const result=await backendCapabilities.call<{items:any[]}>('testagram.threads.quotes.list',{thread_id:threadId,limit:Math.min(100,Math.max(1,limit))});return result.items??[];}
export async function createThreadQuote(threadId:string,_userId:string,content:string,media_urls:any[]=[]){return backendCapabilities.call('testagram.threads.quotes.create',{thread_id:threadId,content:content.trim(),media_urls});}
