import { socialApi } from '@/services/socialApiClient';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { togglePostLike } from '@/services/postInteractionService';
import { socialApi } from '@/services/socialApiClient';
export type LikeItem={id:string;user_id:string;post_id:string;created_at:string;profile:any};
export async function getLikeState(postId:string){const state=await socialApi.getLikeState(postId);return {is_liked:state.liked,likes_count:state.likes_count};}
export async function toggleLike(postId:string,currentlyLiked=false){return togglePostLike(postId,currentlyLiked);}
export async function listLikes(postId:string,limit=50):Promise<LikeItem[]>{const result=await socialApi.listPostInteractions(postId,'likes',limit);return result.items as LikeItem[];}
export async function listProfileLikes(userId:string,limit=50,offset=0):Promise<any[]>{const result=await backendCapabilities.call<{items:any[]}>('testagram.profile.likes.list',{user_id:userId,limit:Math.min(100,Math.max(1,limit)),offset:Math.max(0,Math.floor(offset))});return result.items??[];}
