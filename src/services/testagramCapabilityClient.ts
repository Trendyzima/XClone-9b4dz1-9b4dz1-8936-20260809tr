import { socialApi } from '@/services/socialApiClient';
import { testagramApi } from '@/services/testagramApi';
import { TestagramApiError } from '@/services/testagramApiClient';

const isFreshAppwriteMode = import.meta.env.VITE_TESTAGRAM_FRESH_MODE === 'true' ||
  (import.meta.env.VITE_TESTAGRAM_AUTH_PROVIDER ?? '').trim().toLowerCase() === 'appwrite';
export type CapabilityError={code:string;message:string};
export type CapabilityResponse<T>={ok:boolean;data:T|null;error:CapabilityError|null;request_id:string};
export type CapabilityPage<T>={items:T[];next_cursor:string|null};
export type SearchDiscoveryPage={users:any[];hashtags:any[];posts:any[];communities:any[];instances?:any[];next_cursor:string|null};
export type LikeState={is_liked:boolean;likes_count:number};
export type RepostState={is_reposted:boolean;reposts_count:number};
export type FollowState={following:boolean;requested:boolean;followed_by?:boolean;status?:string;following_id?:string};
export type NotificationItem={id:string;recipient_id:string;actor_id:string|null;kind:string;post_id:string|null;read_at:string|null;created_at:string;data:Record<string,unknown>|null;priority:string|null;category:string|null;group_key:string|null;action_url:string|null;expires_at:string|null;archived_at:string|null;dedupe_key:string|null;actor:{id:string;username:string|null;display_name:string|null;avatar_url:string|null;verified:boolean}|null};
export type PushConfig={public_key:string;subject:string};
export type NewsifyTrendItem={id:string;newsify_item_id:string;newsify_trend_id:string|null;trend_title:string|null;title:string;excerpt:string|null;detail_url:string|null;source_url:string|null;source_name:string;geo:string;language:string;importance_score:number|null;importance_tier:number|null;trend_traffic:number|null;published_at:string;fetched_at:string;updated_at:string;metadata:Record<string,unknown>};
export type NotificationPreference={id:string;user_id:string;notif_type:string;in_app:boolean;push:boolean;email:boolean;sound_enabled:boolean;vibration_enabled:boolean;digest_frequency:string;quiet_hours_start:string|null;quiet_hours_end:string|null;timezone:string;muted_until:string|null;updated_at:string};
export type TestagramCapabilityClientOptions={endpoint:string;getAccessToken?:()=>Promise<string|null>;clientName?:string;clientVersion?:string;timeoutMs?:number;apiKey?:string};
export class CapabilityClientError extends Error{readonly code:string;readonly requestId:string|null;readonly status:number|null;constructor(message:string,o:{code?:string;requestId?:string|null;status?:number|null}={}){super(message);this.name="CapabilityClientError";this.code=o.code??"CAPABILITY_REQUEST_FAILED";this.requestId=o.requestId??null;this.status=o.status??null;}}
const limit=(n=20)=>Math.min(100,Math.max(1,Number.isFinite(n)?Math.floor(n):20));
const cursor=(c?:string)=>c?{cursor:c}:{};
const CAPABILITY_GATEWAY_ENDPOINT='/api/capability';
export class TestagramCapabilityClient{
 private readonly endpoint: string;
 constructor(o:TestagramCapabilityClientOptions){
  const endpoint = o.endpoint.trim();
  if (endpoint !== '/api/capability') {
   throw new Error('Capability endpoint must use the registered public Backend capability route.');
  }
  this.endpoint = endpoint;
 }
 async call<T>(capability: string, input: Record<string, unknown> = {}, _tokenOverride?: string | null): Promise<T> {
  const normalizedCapability = capability.trim();
  if (!/^[a-z][a-z0-9_.-]{2,127}$/.test(normalizedCapability)) {
   throw new CapabilityClientError('Capability name is invalid.', { code: 'CAPABILITY_NAME_INVALID', status: 400 });
  }
  try {
   return await testagramApi.request<T>(this.endpoint, {
    method: 'POST',
    body: { capability: normalizedCapability, input },
   });
  } catch (error) {
   if (error instanceof TestagramApiError) {
    throw new CapabilityClientError(error.message, {
     code: error.code,
     status: error.status,
     requestId: error.requestId,
    });
   }
   if (error instanceof CapabilityClientError) throw error;
   throw new CapabilityClientError(error instanceof Error ? error.message : 'Backend capability request failed.', {
    code: 'CAPABILITY_REQUEST_FAILED',
   });
  }
 }
 listCapabilities(){return this.call<{capabilities:unknown[]}>("testagram.capabilities.list")} health(){return this.call<{services:unknown[]}>("testagram.health.read")}
 listPosts(n=20,c?:string,feed:"following"|"global"|"profile"|"community"="following",targetId?:string){return this.call<CapabilityPage<unknown>>("testagram.posts.list",{limit:limit(n),feed,...targetId?{target_id:targetId}:{},...cursor(c)})}
 searchPosts(q:string,n=20,c?:string,options:{mediaOnly?:boolean;verifiedOnly?:boolean}={}){return this.call<CapabilityPage<any>>("testagram.search.posts",{q,limit:limit(n),...options.mediaOnly?{media_only:true}:{},...options.verifiedOnly?{verified_only:true}:{},...cursor(c)})}
 searchUsers(q:string,n=20,c?:string){return this.call<CapabilityPage<any>>("testagram.search.users",{q,limit:limit(n),...cursor(c)})}
 searchHashtags(q:string,n=20,c?:string){return this.call<CapabilityPage<any>>("testagram.search.hashtags",{q,limit:limit(n),...cursor(c)})}
 async searchUnified(q: string, kind: "all"|"people"|"posts"|"hashtags"|"threads"|"communities"|"fediverse"|"media"|"latest"|"top"|"instances" = "all", n = 40, offset = 0, sort = "relevance") {
  return this.call<{ items: unknown[]; next_cursor: string | null }>("testagram.search.unified", {
    q, kind, limit: limit(n), offset: Math.max(0, Math.floor(offset)), sort,
  });
 }
 searchCommunities(q:string,n=20,c?:string){return this.call<CapabilityPage<any>>("testagram.search.communities",{q,limit:limit(n),...cursor(c)})}
 async searchDiscovery(_endpoint:string,q:string,mode:"search"|"suggest"="search",n=20,c?:string):Promise<SearchDiscoveryPage>{const size=limit(mode==="suggest"?Math.min(n,8):n);const normalized=q.trim().replace(/^[@#]/,'');const [users,hashtags,posts,communities]=await Promise.all([this.searchUsers(normalized,size,c),this.searchHashtags(normalized,size,c),this.searchPosts(q.trim(),size,c),this.searchCommunities(normalized,size,c)]);return{users:users.items,hashtags:hashtags.items,posts:posts.items,communities:communities.items,next_cursor:posts.next_cursor};}
 createPost(input:{body?:string;content?:string;communityId?:string;mediaUrl?:string;mediaType?:string;mediaUrls?:string[];imageUrl?:string;videoUrl?:string;isVideo?:boolean;mediaCount?:number;visibility?:string;replyToPostId?:string;quotedPostId?:string;quotePostId?:string;quoteOfPostId?:string;poll?:{question:string;options:string[];durationMinutes?:number;multipleChoice?:boolean};productIds?:string[];idempotencyKey?:string},accessToken?:string){
  if(isFreshAppwriteMode){
   const hasUnsupportedFeature=Boolean(input.communityId||input.mediaUrl||input.mediaType||input.mediaUrls?.length||input.imageUrl||input.videoUrl||input.isVideo||input.mediaCount||input.replyToPostId||input.quotedPostId||input.quotePostId||input.quoteOfPostId||input.poll||input.productIds?.length);
   if(hasUnsupportedFeature)throw new CapabilityClientError('Fresh Appwrite publishing currently supports text-only posts. Media attachments, communities, polls, quotes and product tags are not enabled yet.',{code:'FRESH_API_POST_FEATURE_NOT_PORTED',status:503});
   const visibility=(input.visibility??'public').toLowerCase();
   if(visibility!=='public'&&visibility!=='followers'&&visibility!=='private')throw new CapabilityClientError('Unsupported post visibility.',{code:'INVALID_VISIBILITY',status:400});
   return socialApi.createPost(input.content??input.body??'',visibility,false,input.idempotencyKey).then(post=>({post_id:post.$id,created:true}));
  }
  return this.call<{post_id:string;poll_id?:string|null;created:boolean}>("testagram.posts.create",{body:input.body??input.content??"",content:input.content??input.body??"",...input.communityId?{community_id:input.communityId}:{},...input.mediaUrl?{media_url:input.mediaUrl}:{},...input.mediaType?{media_type:input.mediaType}:{},...input.mediaUrls?{media_urls:input.mediaUrls}:{},...input.imageUrl?{image_url:input.imageUrl}:{},...input.videoUrl?{video_url:input.videoUrl}:{},...(input.isVideo!==undefined?{is_video:input.isVideo}:{}),...(input.mediaCount!==undefined?{media_count:input.mediaCount}:{}),...input.visibility?{visibility:input.visibility}:{},...input.replyToPostId?{reply_to_post_id:input.replyToPostId}:{},...input.quotedPostId?{quoted_post_id:input.quotedPostId}:{},...input.quotePostId?{quote_post_id:input.quotePostId}:{},...input.quoteOfPostId?{quote_of_post_id:input.quoteOfPostId}:{},...input.poll?{poll:{question:input.poll.question,options:input.poll.options,...input.poll.durationMinutes!==undefined?{duration_minutes:input.poll.durationMinutes}:{},...(input.poll.multipleChoice!==undefined?{multiple_choice:input.poll.multipleChoice}:{})}}:{},...input.productIds?{product_ids:input.productIds}:{}},accessToken)
 }
schedulePost(body:string,scheduledFor:string){return this.call<{scheduled_post_id:string;scheduled:boolean}>("testagram.posts.schedule",{body,scheduled_for:scheduledFor})} generateRecommendations(){return this.call<{recommendations:unknown[]}>("testagram.recommendations.generate")} rankNotifications(n=20){return this.call<CapabilityPage<unknown>>("testagram.notifications.rank",{limit:limit(n)})}
 listNotifications(n=20,c?:string,options:{kind?:string;category?:string;unreadOnly?:boolean}={}){return this.call<CapabilityPage<NotificationItem>>("testagram.notifications.list",{limit:limit(n),...options.kind?{kind:options.kind}:{},...options.category?{category:options.category}:{},...options.unreadOnly?{unread_only:true}:{},...cursor(c)})}
 getUnreadNotificationCount(){return this.call<{count:number}>("testagram.notifications.unread_count")}
 markNotificationRead(notificationId:string){return this.call<{notification_id:string;read:boolean}>("testagram.notifications.mark_read",{notification_id:notificationId})}
 markAllNotificationsRead(){return this.call<{updated:number}>("testagram.notifications.mark_all_read")}
 listNotificationPreferences(){return this.call<{items:NotificationPreference[]}>("testagram.notifications.preferences")}
 upsertNotificationPreference(input:{notif_type:string;in_app:boolean;push:boolean;email:boolean;sound_enabled?:boolean;vibration_enabled?:boolean;digest_frequency?:string;quiet_hours_start?:string|null;quiet_hours_end?:string|null;timezone?:string;muted_until?:string|null}){return this.call<{preference:NotificationPreference}>("testagram.notifications.preference_upsert",input)}
 dismissNotification(notificationId:string){return this.call<{notification_id:string;dismissed:boolean}>("testagram.notifications.dismiss",{notification_id:notificationId})}
 getPushConfig(){return this.call<PushConfig>("testagram.notifications.push.config")}
 subscribePush(input:{endpoint:string;p256dh:string;auth_key:string;platform?:string}){return this.call<{subscribed:boolean}>("testagram.notifications.subscribe",input)}
 unsubscribePush(endpoint:string){return this.call<{unsubscribed:boolean}>("testagram.notifications.unsubscribe",{endpoint})}
 testPush(){return this.call<{notification_id:string;queued:boolean}>("testagram.notifications.test_push")}
 getNotificationSubscription(){return this.call<{schema:string;table:string;event:string;filter:string;authenticated:boolean}>("testagram.notifications.realtime_contract")}
 listLists(){return this.call<{items:unknown[]}>("testagram.lists.list")} createList(name:string,description?:string,isPrivate?:boolean){return this.call<{list:unknown}>("testagram.lists.create",{name,...description!==undefined?{description}:{},...isPrivate!==undefined?{is_private:isPrivate}:{}})} addListMember(listId:string,userId:string){return this.call<{member:unknown}>("testagram.lists.member.add",{list_id:listId,user_id:userId})} removeListMember(listId:string,userId:string){return this.call<{removed:boolean}>("testagram.lists.member.remove",{list_id:listId,user_id:userId})} getListTimeline(listId:string,n=20,c?:string){return this.call<CapabilityPage<unknown>>("testagram.lists.timeline",{list_id:listId,limit:limit(n),...cursor(c)})}
 listBookmarks(n=20,c?:string){return this.call<CapabilityPage<unknown>>("testagram.bookmarks.list",{limit:limit(n),...cursor(c)})} bookmarkPost(postId:string){return socialApi.setBookmark(postId,true).then(bookmark=>({bookmark:{post_id:postId,...bookmark}}))} removeBookmark(postId:string){return socialApi.setBookmark(postId,false).then(result=>({removed:!result.bookmarked}))} listBookmarkFolders(){return this.call<{items:unknown[]}>("testagram.bookmarks.folders.list")} createBookmarkFolder(name:string){return this.call<{folder:unknown}>("testagram.bookmarks.folders.create",{name})}
 getTrends(n=20){return this.call<{items:unknown[]}>("testagram.trends.list",{limit:limit(n)})} listNewsifyTrending(n=20,geo="US",language="english"){return this.call<{items:NewsifyTrendItem[];geo:string;language:string}>("testagram.news.trending",{limit:limit(n),geo,language})} getProfileTimeline(userId:string,n=20,c?:string){return this.call<CapabilityPage<any>>("testagram.profile.timeline",{user_id:userId,limit:limit(n),...cursor(c)})} async followUser(userId:string,follow=true){const result=await socialApi.setFollow(userId,follow);const status=follow&&'status' in result?result.status:'none';return {state:{following:status==='accepted',requested:status==='pending',status}}} getFollowState(userId:string){return socialApi.getFollowState(userId).then(state=>({state}))} listFollowRequests(n=20,c?:string){return this.call<CapabilityPage<any>>("testagram.follow_requests.list",{limit:limit(n),...cursor(c)})} respondFollowRequest(requesterId:string,action:"accept"|"reject"){return socialApi.respondFollowRequest(requesterId,action).then(result=>({requester_id:requesterId,target_id:"",action,status:result.status}))} likePost(postId:string){return socialApi.setLike(postId,true).then(result=>({state:{is_liked:result.liked,likes_count:result.likes_count}}))} quotePost(quotedPostId:string,content:string){return this.createPost({content,quotedPostId})} getLikeState(postId:string){return this.call<{state:LikeState}>("testagram.posts.like.state",{post_id:postId})} repostPost(postId:string){return socialApi.setRepost(postId,true).then(result=>({state:{is_reposted:result.reposted,reposts_count:result.reposts_count}}))} getRepostState(postId:string){return this.call<{state:RepostState}>("testagram.posts.repost.state",{post_id:postId})} listReplies(postId:string,n=50){return this.call<CapabilityPage<any>>("testagram.replies.list",{post_id:postId,limit:limit(n)})} createReply(postId:string,content:string,parentReplyId?:string){return socialApi.createReply(postId,content,parentReplyId).then(result=>({...result,created:true}))}
 listMedia(n=20,c?:string){return this.call<CapabilityPage<unknown>>("testagram.media.list",{limit:limit(n),...cursor(c)})} attachMedia(postId:string,mediaAssetId:string,sortOrder=0){return this.call<{media:unknown}>("testagram.media.attach",{post_id:postId,media_asset_id:mediaAssetId,sort_order:sortOrder})}
 listCommunities(n=20){return this.call<{items:unknown[]}>("testagram.communities.list",{limit:limit(n)})} createCommunity(name:string,options:Record<string,unknown>={}){return this.call<{community:unknown}>("testagram.communities.create",{name,...options})} joinCommunity(communityId:string){return this.call<{membership:unknown}>("testagram.communities.join",{community_id:communityId})} leaveCommunity(communityId:string){return this.call<{membership:unknown}>("testagram.communities.leave",{community_id:communityId})}
 getFederationStatus(n=20,c?:string){return this.call<CapabilityPage<unknown>>("testagram.federation.status",{limit:limit(n),...cursor(c)})} getWallet(n=20,c?:string){return this.call<{wallet:unknown;transactions:unknown[];next_cursor:string|null}>("testagram.wallet.read",{limit:limit(n),...cursor(c)})} getWalletTransactions(n=20,c?:string){return this.getWallet(n,c).then(x=>({items:x.transactions,next_cursor:x.next_cursor}))}
}

export const backendCapabilities = new TestagramCapabilityClient({
 endpoint: CAPABILITY_GATEWAY_ENDPOINT,
});
// Canonical capability client boundary: authenticated browser gateway only.
