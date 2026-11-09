import { socialApi } from '@/services/socialApiClient';
import { togglePostRepost } from '@/services/postInteractionService';
import { socialApi } from '@/services/socialApiClient';
export type RepostItem={id:string;user_id:string;post_id:string;created_at:string;profile:any};
export async function getRepostState(postId:string){const state=await socialApi.getRepostState(postId);return {is_reposted:state.reposted,reposts_count:state.reposts_count};}
export async function toggleRepost(postId:string,currentlyReposted=false){return togglePostRepost(postId,currentlyReposted);}
export async function listReposts(postId:string,limit=50):Promise<RepostItem[]>{const result=await socialApi.listPostInteractions(postId,'reposts',limit);return result.items as RepostItem[];}
