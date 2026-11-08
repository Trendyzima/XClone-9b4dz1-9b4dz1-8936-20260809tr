import { socialApi } from '@/services/socialApiClient';
import { testagramApiRequest, TestagramApiError } from '@/services/apiClient';
import { appwriteAuth } from '@/services/appwriteAuth';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';

// XClone is Appwrite-authenticated; no Supabase mode or fallback exists.
const isFreshAppwriteMode = true;
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
export type TestagramCapabilityClientOptions={endpoint:string;getAccessToken:()=>Promise<string|null>;clientName?:string;clientVersion?:string;timeoutMs?:number};
export class CapabilityClientError extends Error{readonly code:string;readonly requestId:string|null;readonly status:number|null;constructor(message:string,o:{code?:string;requestId?:string|null;status?:number|null}={}){super(message);this.name="CapabilityClientError";this.code=o.code??"CAPABILITY_REQUEST_FAILED";this.requestId=o.requestId??null;this.status=o.status??null;}}
// Only registry capabilities marked access: "public" may omit authentication.
// Every request targets the separately deployed Backend API; XClone has no API proxy.
const PUBLIC_CAPABILITIES=new Set(["testagram.capabilities.list","testagram.health.read","testagram.news.trending"]);
// This prevents profile/search paths from falling back to a stale VITE_* key.
const configuredBackendOrigin=(import.meta.env.VITE_TESTAGRAM_API_URL??"").trim().replace(/\/+$/,"");
const CAPABILITY_GATEWAY_ENDPOINT=configuredBackendOrigin?`${configuredBackendOrigin}/api/capability`:"";
const READ_ONLY_CAPABILITY_PREFIXES=['testagram.capabilities.list','testagram.health.read','testagram.news.trending','testagram.posts.list','testagram.search.','testagram.notifications.list','testagram.notifications.unread_count','testagram.notifications.preferences','testagram.lists.list','testagram.lists.timeline','testagram.bookmarks.list','testagram.bookmarks.folders.list','testagram.trends.list','testagram.profile.timeline','testagram.follow_requests.list','testagram.posts.like.state','testagram.posts.repost.state','testagram.replies.list','testagram.media.list','testagram.communities.list','testagram.hashtags.follow.list','testagram.hashtags.trending','testagram.hashtags.follow.state','testagram.federation.status','testagram.wallet.read','testagram.messages.list','testagram.conversations.list','testagram.calls.list','testagram.calls.get','testagram.audio_spaces.list_live','testagram.audio_spaces.get','testagram.audio_spaces.my_status','testagram.audio_spaces.pending_speaker_requests'];
const isReadOnlyCapability=(name:string)=>READ_ONLY_CAPABILITY_PREFIXES.some(prefix=>prefix.endsWith('.')?name.startsWith(prefix):name===prefix);
const limit=(n=20)=>Math.min(100,Math.max(1,Number.isFinite(n)?Math.floor(n):20));
const cursor=(c?:string)=>c?{cursor:c}:{};
const rid=()=>typeof crypto?.randomUUID==="function"?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const capabilityEvent=(capability:string)=>{
 if(capability.startsWith('testagram.bookmarks.add'))return TestagramEvent.BOOKMARK_ADDED;
 if(capability.startsWith('testagram.bookmarks.remove'))return TestagramEvent.BOOKMARK_REMOVED;
 if(capability.startsWith('testagram.communities.create'))return TestagramEvent.COMMUNITY_CREATED;
 if(capability.startsWith('testagram.communities.join'))return TestagramEvent.COMMUNITY_JOINED;
 if(capability.startsWith('testagram.communities.leave'))return TestagramEvent.COMMUNITY_LEFT;
 if(capability.startsWith('testagram.notifications.mark_read'))return TestagramEvent.NOTIFICATION_READ;
 if(capability.startsWith('testagram.notifications.mark_all_read'))return TestagramEvent.NOTIFICATION_READ;
 return null;
};
export class TestagramCapabilityClient{
 private endpoint:string;private token:()=>Promise<string|null>;private name:string;private version:string;private timeout:number;
 constructor(o:TestagramCapabilityClientOptions){this.endpoint=o.endpoint.trim().replace(/\/$/,"");this.token=o.getAccessToken;this.name=o.clientName??"testagram-client";this.version=o.clientVersion??"2";this.timeout=Math.min(30000,Math.max(1000,Math.floor(o.timeoutMs??15000)));}
 private async request<T>(capability:string,input:Record<string,unknown>,token:string|null,id:string,ctl:AbortController){
  try {
    if (!this.endpoint) throw new CapabilityClientError("VITE_TESTAGRAM_API_URL is required; XClone does not provide a same-origin API proxy.", { code: "BACKEND_API_URL_REQUIRED" });
    const configuredOrigin = (import.meta.env.VITE_TESTAGRAM_API_URL ?? '').trim().replace(/\/+$/, '');
    const endpoint = new URL(this.endpoint);
    if (!configuredOrigin || endpoint.origin !== new URL(configuredOrigin).origin || endpoint.pathname !== '/api/capability') {
      throw new CapabilityClientError("Capability gateway must use the canonical Backend API origin and /api/capability route.", { code: "API_ORIGIN_MISMATCH" });
    }
    const data = await testagramApiRequest<T>('/api/capability', {
      method: 'POST',
      body: { capability, input },
      accessToken: token ?? undefined,
      anonymous: !token,
      signal: ctl.signal,
      headers: {
        'X-Client-Info': `testagram-web/${this.version}`,
        ...( !isReadOnlyCapability(capability) ? { 'Idempotency-Key': id } : {}),
      },
      timeoutMs: this.timeout,
    });
    return { r: { ok: true, status: 200 }, p: { ok: true, data, error: null, request_id: id } };
  } catch (error) {
    if (error instanceof CapabilityClientError) throw error;
    if (error instanceof TestagramApiError) {
      return {
        r: { ok: false, status: error.status },
        p: { ok: false, data: null, error: { code: error.code, message: error.message }, request_id: error.requestId ?? id },
      };
    }
    throw error;
  }
 }
 async call<T>(capability:string,input:Record<string,unknown>={},tokenOverride?:string|null):Promise<T>{
  if(!capability.trim())throw new CapabilityClientError("Capability name is required",{code:"CAPABILITY_REQUIRED"});
  const isPublic=PUBLIC_CAPABILITIES.has(capability);
  let token=tokenOverride ?? await this.token();
  if(!token&&!isPublic)throw new CapabilityClientError("Authentication required",{code:"AUTH_REQUIRED",status:401});
  const id=rid(),ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),this.timeout),startedAt=Date.now();
  try{
    let attempt=0;
    while(true){
      const {r,p}=await this.request<T>(capability,input,token,id,ctl);
      if(r.ok&&p.ok){
        const event=capabilityEvent(capability);
        trackTestagramEvent(TestagramEvent.CAPABILITY_SUCCEEDED,{capability,duration_ms:Date.now()-startedAt});
        if(event)trackTestagramEvent(event,{capability});
        return p.data as T;
      }
      const authFailure=!isPublic&&(r.status===401||r.status===403)&&p.error?.code==="AUTH_REQUIRED";
      if(authFailure&&attempt===0){
        attempt++;
        token=await appwriteAuth.createBackendJWT(true).catch(()=>null);
        if(token)continue;
      }
      throw new CapabilityClientError(p.error?.message??`Capability request failed (${r.status})`,{code:p.error?.code??"CAPABILITY_REQUEST_FAILED",requestId:p.request_id??id,status:r.status});
    }
  }catch(e){
    trackTestagramEvent(TestagramEvent.CAPABILITY_FAILED,{capability,duration_ms:Date.now()-startedAt,error_type:e instanceof Error?e.name:"unknown",error_code:e instanceof CapabilityClientError?e.code:undefined});
    if(e instanceof CapabilityClientError)throw e;
    if(e instanceof DOMException&&e.name==="AbortError")throw new CapabilityClientError("Capability request timed out",{code:"TIMEOUT",requestId:id});
    throw new CapabilityClientError(e instanceof Error?e.message:"Capability request failed",{code:"NETWORK_ERROR",requestId:id});
  }finally{clearTimeout(timer)}
}
 listCapabilities(){return this.call<{capabilities:unknown[]}>("testagram.capabilities.list")} health(){return this.call<{services:unknown[]}>("testagram.health.read")}
 listPosts(n=20,c?:string,feed:"following"|"global"|"profile"|"community"="following",targetId?:string){return this.call<CapabilityPage<unknown>>("testagram.posts.list",{limit:limit(n),feed,...targetId?{target_id:targetId}:{},...cursor(c)})}
 searchPosts(q:string,n=20,c?:string,options:{mediaOnly?:boolean;verifiedOnly?:boolean}={}){return this.call<CapabilityPage<any>>("testagram.search.posts",{q,limit:limit(n),...options.mediaOnly?{media_only:true}:{},...options.verifiedOnly?{verified_only:true}:{},...cursor(c)})}
 searchUsers(q:string,n=20,c?:string){return this.call<CapabilityPage<any>>("testagram.search.users",{q,limit:limit(n),...cursor(c)})}
 searchHashtags(q:string,n=20,c?:string){return this.call<CapabilityPage<any>>("testagram.search.hashtags",{q,limit:limit(n),...cursor(c)})} resolveHashtag(tag:string){return this.call<{id:string;tag:string;usage_count:number;post_count:number;follower_count:number}>("testagram.hashtags.resolve",{tag})} getHashtagFollowState(hashtagId:string){return this.call<{following:boolean}>("testagram.hashtags.follow.state",{hashtag_id:hashtagId})} setHashtagFollow(hashtagId:string,following:boolean){return this.call<{following:boolean}>("testagram.hashtags.follow.toggle",{hashtag_id:hashtagId,following})} listFollowedHashtags(){return this.call<{items:any[]}>("testagram.hashtags.follow.list",{})} listTrendingHashtags(n=50){return this.call<{items:any[]}>("testagram.hashtags.trending",{limit:limit(n)})}
 async searchUnified(q:string,kind:"all"|"people"|"posts"|"hashtags"|"threads"|"communities"|"fediverse"|"media"|"latest"|"top"|"instances"="all",n=40,offset=0,sort="relevance"){
   const payload=await this.call<any>("testagram.search.unified",{q,kind,limit:limit(n),offset:Math.max(0,Math.trunc(offset)),sort});
   return {users:Array.isArray(payload?.users)?payload.users:[],hashtags:Array.isArray(payload?.hashtags)?payload.hashtags:[],posts:Array.isArray(payload?.posts)?payload.posts:[],threads:Array.isArray(payload?.threads)?payload.threads:[],communities:Array.isArray(payload?.communities)?payload.communities:[],replies:Array.isArray(payload?.replies)?payload.replies:[],fediverse:Array.isArray(payload?.fediverse)?payload.fediverse:[],instances:Array.isArray(payload?.instances)?payload.instances:[],next_cursor:payload?.next_cursor??null};
 }
 private async searchFallbackForKind(kind:string,q:string,n:number,directFailure:unknown,gatewayError:unknown){
  const normalized=q.trim().replace(/^[@#]/,'');
  try{
   let users:any[]=[];
   let hashtags:any[]=[];
   let posts:any[]=[];
   let communities:any[]=[];
   let nextCursor:string|null=null;
   switch(kind){
    case "people":{
     const result=await this.searchUsers(normalized,Math.min(limit(n),10));
     users=result.items??[];nextCursor=result.next_cursor??null;break;
    }
    case "hashtags":{
     const result=await this.searchHashtags(normalized,Math.min(limit(n),10));
     hashtags=result.items??[];nextCursor=result.next_cursor??null;break;
    }
    case "communities":{
     const result=await this.searchCommunities(normalized,Math.min(limit(n),10));
     communities=result.items??[];nextCursor=result.next_cursor??null;break;
    }
    case "media":{
     const result=await this.searchPosts(q,Math.min(limit(n),10),undefined,{mediaOnly:true});
     posts=result.items??[];nextCursor=result.next_cursor??null;break;
    }
    case "posts":
    case "latest":
    case "top":
    case "all":{
     const result=await this.searchPosts(q,Math.min(limit(n),10));
     posts=result.items??[];nextCursor=result.next_cursor??null;break;
    }
    default:
     throw directFailure instanceof Error?directFailure:new CapabilityClientError("This search category is temporarily unavailable. Retry in a moment.",{code:"SEARCH_FALLBACK_UNAVAILABLE"});
   }
   return {users,hashtags,posts,threads:[],communities,replies:[],fediverse:[],instances:[],next_cursor:nextCursor,partial:true};
  }catch(fallbackError){
   if(fallbackError instanceof CapabilityClientError&&fallbackError.code==="AUTH_REQUIRED")throw fallbackError;
   if(directFailure instanceof Error)throw directFailure;
   if(gatewayError instanceof Error)throw gatewayError;
   throw fallbackError;
  }
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
schedulePost(body:string,scheduledFor:string,communityId?:string){return testagramApiRequest<{scheduled_post_id:string;scheduled:boolean;status:string}>("/api/scheduled-posts",{method:"POST",body:{content:body,scheduled_for:scheduledFor,...communityId?{community_id:communityId}:{}}})} listScheduledPosts(){return testagramApiRequest<CapabilityPage<any>>("/api/scheduled-posts")} cancelScheduledPost(id:string){return testagramApiRequest<{scheduled_post_id:string;cancelled:boolean}>("/api/scheduled-posts/"+encodeURIComponent(id),{method:"DELETE"})} generateRecommendations(){return this.call<{recommendations:unknown[]}>("testagram.recommendations.generate")} rankNotifications(n=20){return this.call<CapabilityPage<unknown>>("testagram.notifications.rank",{limit:limit(n)})}
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
 getCommunity(slug:string){return testagramApiRequest<{community:any}>('/api/communities/'+encodeURIComponent(slug))}
 listCommunityChat(communityId:string){return testagramApiRequest<CapabilityPage<any>>('/api/communities/'+encodeURIComponent(communityId)+'/chat')}
 sendCommunityChat(communityId:string,message:string){return testagramApiRequest<{id:string;community_id:string;user_id:string;message:string}>('/api/communities/'+encodeURIComponent(communityId)+'/chat',{method:'POST',body:{message}})}
 toggleCommunityChatReaction(communityId:string,messageId:string,emoji:string){return testagramApiRequest<{message_id:string;emoji:string;active:boolean}>('/api/communities/'+encodeURIComponent(communityId)+'/chat/'+encodeURIComponent(messageId)+'/reactions',{method:'POST',body:{emoji}})}
 toggleCommunityChatPin(communityId:string,messageId:string){return testagramApiRequest<{message_id:string;pinned:boolean}>('/api/communities/'+encodeURIComponent(communityId)+'/chat/'+encodeURIComponent(messageId)+'/pin',{method:'POST',body:{}})}
 listCommunityMembers(communityId:string,n=20){const query=new URLSearchParams({limit:String(limit(n))});return testagramApiRequest<CapabilityPage<any>>('/api/communities/'+encodeURIComponent(communityId)+'/members?'+query.toString())}
 createCommunityPoll(communityId:string,input:{question:string;options:string[];duration_minutes:number;description?:string}){return testagramApiRequest<{post_id:string;poll:any}>('/api/communities/'+encodeURIComponent(communityId)+'/polls',{method:'POST',body:input})}
 getPoll(pollId:string){return testagramApiRequest<{poll:any}>('/api/social/polls/'+encodeURIComponent(pollId))}
 votePoll(pollId:string,optionId:string){return testagramApiRequest<{poll_id:string;option_id:string;voted:boolean}>('/api/social/polls/'+encodeURIComponent(pollId)+'/vote',{method:'POST',body:{option_id:optionId}})}
 listCommunityPosts(communityId:string,n=30,page=0){const query=new URLSearchParams({limit:String(limit(n)),page:String(Math.max(0,Math.floor(page)))});return testagramApiRequest<CapabilityPage<any>>('/api/communities/'+encodeURIComponent(communityId)+'/posts?'+query.toString())}
 createCommunityPost(communityId:string,input:{text:string;media_ids?:string[];language?:string}){return testagramApiRequest<{id:string;community_id:string;author_id:string;text:string;content:string}>('/api/communities/'+encodeURIComponent(communityId)+'/posts',{method:'POST',body:input})}

 createSelfNotification(input:{kind:string;payload:Record<string,unknown>;event_key:string}){return testagramApiRequest<{id:string;created:boolean}>('/api/social/notifications',{method:'POST',body:input})} scheduleCommunityPost(input:{content:string;scheduled_for:string;community_id:string}){return testagramApiRequest<{scheduled_post_id:string;community_id:string;scheduled_for:string;status:string}>('/api/scheduled-posts',{method:'POST',body:input})}
 updateCommunity(communityId:string,input:Record<string,unknown>){return testagramApiRequest<{updated:boolean;community_id:string}>('/api/communities/'+encodeURIComponent(communityId),{method:'PATCH',body:input})}
 moderateCommunityPost(communityId:string,postId:string){return testagramApiRequest<{post_id:string;moderated:boolean}>('/api/communities/'+encodeURIComponent(communityId)+'/posts/'+encodeURIComponent(postId)+'/moderate',{method:'POST',body:{}})}
 updateCommunityMemberRole(communityId:string,userId:string,role:'member'|'moderator'){return testagramApiRequest<{user_id:string;role:string}>('/api/communities/'+encodeURIComponent(communityId)+'/members/'+encodeURIComponent(userId)+'/role',{method:'POST',body:{role}})}
 removeCommunityMember(communityId:string,userId:string){return testagramApiRequest<{user_id:string;removed:boolean}>('/api/communities/'+encodeURIComponent(communityId)+'/members/'+encodeURIComponent(userId),{method:'DELETE'})}
 listCommunityShop(communityId:string){return testagramApiRequest<CapabilityPage<any>>('/api/communities/'+encodeURIComponent(communityId)+'/shop')}
 listCommunityBadges(communityId:string){return testagramApiRequest<CapabilityPage<any>>('/api/communities/'+encodeURIComponent(communityId)+'/badges')}
 claimCommunityBadge(communityId:string){return testagramApiRequest<{id:string;badge_tier:string;contribution_score:number;issued:boolean}>('/api/communities/'+encodeURIComponent(communityId)+'/badges/claim',{method:'POST',body:{}})}
 listCommunityEvents(communityId:string){return testagramApiRequest<CapabilityPage<any>>('/api/communities/'+encodeURIComponent(communityId)+'/events')}
 createCommunityEvent(communityId:string,input:{title:string;description?:string;starts_at:string}){return testagramApiRequest<{id:string;community_id:string;title:string;starts_at:string}>('/api/communities/'+encodeURIComponent(communityId)+'/events',{method:'POST',body:input})}
 setCommunityEventRSVP(eventId:string,active:boolean){return testagramApiRequest<{event_id:string;attending:boolean}>('/api/community-events/'+encodeURIComponent(eventId)+'/rsvp',{method:active?'POST':'DELETE',...(active?{body:{}}:{})})}
 listCommunities(n=20,filters:Record<string,unknown>={}){const query=new URLSearchParams({limit:String(limit(n))});for(const key of ['q','category','tab','sort','page'] as const){const value=filters[key];if(value!==undefined&&value!==null&&String(value)!=='')query.set(key,String(value));}if(filters.exclude_joined===true)query.set('exclude_joined','true');return testagramApiRequest<CapabilityPage<any>>('/api/communities?'+query.toString())} createCommunity(name:string,options:Record<string,unknown>={}){return testagramApiRequest<{community:unknown}>('/api/communities',{method:'POST',body:{name:String(options.display_name??name),slug:name,description:String(options.description??''),visibility:options.is_private===true?'private':'public',icon_url:String(options.icon_url??''),banner_url:String(options.banner_url??''),rules:Array.isArray(options.rules)?options.rules:[]}})} joinCommunity(communityId:string){return testagramApiRequest<{community_id:string;joined:boolean}>('/api/communities/'+encodeURIComponent(communityId)+'/join',{method:'POST',body:{}})} leaveCommunity(communityId:string){return testagramApiRequest<{community_id:string;left:boolean}>('/api/communities/'+encodeURIComponent(communityId)+'/leave',{method:'DELETE'})}
 getFederationStatus(n=20,c?:string){return this.call<CapabilityPage<unknown>>("testagram.federation.status",{limit:limit(n),...cursor(c)})} getWallet(n=20,c?:string,currency='KES'){return Promise.all([this.call<{id:string;user_id:string;balance:string;currency:string;status:string}>("testagram.wallet.balance",{currency}),this.call<{items:unknown[]}>("testagram.wallet.transactions.list",{limit:limit(n),...cursor(c)})]).then(([wallet,history])=>({wallet,transactions:history.items??[],next_cursor:null as string|null}))}
 getWalletTransactions(n=20,c?:string){return this.call<{items:unknown[]}>("testagram.wallet.transactions.list",{limit:limit(n),...cursor(c)}).then(x=>({items:x.items,next_cursor:null as string|null}))}
 transferWallet(recipientId:string,amount:number,note='',idempotencyKey=rid()){return this.call<{transfer_id:string;status:string;duplicate:boolean;amount:string;currency:string}>("testagram.wallet.transfer",{recipient_id:recipientId,amount,note,idempotency_key:idempotencyKey})}
 tipWallet(recipientId:string,amount:number,note='',idempotencyKey=rid()){return this.call<{transfer_id:string;status:string;duplicate:boolean;amount:string;currency:string}>("testagram.wallet.tip",{recipient_id:recipientId,amount,note,idempotency_key:idempotencyKey})}
 listConversations(limitValue=50){return this.call<{items:any[];next_cursor:string|null}>("testagram.conversations.list",{limit:Math.min(100,Math.max(1,Math.floor(limitValue)))})}
 createConversation(memberIds:string[],title=''){return this.call<{conversation_id:string}>("testagram.conversations.create",{member_ids:memberIds,title})}
 listMessages(conversationId:string,limitValue=50,c?:string){return this.call<CapabilityPage<any>>("testagram.messages.list",{conversation_id:conversationId,limit:limit(limitValue),...cursor(c)})}
 sendEncryptedMessage(input:{conversationId:string;ciphertext:string;nonce:string;clientMessageId:string;replyToMessageId?:string;sharedPostId?:string;aad?:string}){return this.call<{message:any}>("testagram.messages.send_encrypted",{conversation_id:input.conversationId,ciphertext:input.ciphertext,nonce:input.nonce,client_message_id:input.clientMessageId,...input.replyToMessageId?{reply_to_message_id:input.replyToMessageId}:{},...input.sharedPostId?{shared_post_id:input.sharedPostId}:{},...input.aad?{aad:input.aad}:{}})}
 editEncryptedMessage(messageId:string,ciphertext:string,nonce:string,aad?:string){return this.call<{message:any}>("testagram.messages.edit_encrypted",{message_id:messageId,ciphertext,nonce,...aad?{aad}:{}})}
 deleteMessage(messageId:string){return this.call<{deleted:boolean}>("testagram.messages.delete",{message_id:messageId})}
 markConversationRead(conversationId:string){return this.call<{read:boolean}>("testagram.messages.mark_read",{conversation_id:conversationId})}
 reactToMessage(messageId:string,reaction:string,remove=false){return this.call<{reacted:boolean}>("testagram.messages.react",{message_id:messageId,reaction,remove})}
 attachMessageMetadata(messageId:string,attachmentMetadata:Record<string,unknown>){return this.call<{attached:boolean}>("testagram.messages.attach",{message_id:messageId,attachment_metadata:attachmentMetadata})}
 getConversationRealtimeTicket(conversationId:string){return this.call<{ticket:string;websocket_url:string;expires_in:number}>("testagram.realtime.ticket",{conversation_id:conversationId})}
 createCall(conversationId:string,kind='audio'){return this.call<{call_id:string;status:string}>("testagram.calls.create",{conversation_id:conversationId,kind})}
 joinCall(callId:string){return this.call<{call_id:string;joined:boolean}>("testagram.calls.join",{call_id:callId})}
 endCall(callId:string){return this.call<{call_id:string;ended:boolean}>("testagram.calls.end",{call_id:callId})}
 listCalls(limitValue=30){return this.call<CapabilityPage<any>>("testagram.calls.list",{limit:Math.min(100,Math.max(1,Math.floor(limitValue)))})}
 getCall(callId:string){return this.call<{call:any}>("testagram.calls.get",{call_id:callId})}
 getCallMediaToken(roomId:string){return this.call<{token:string;ws_url:string;room_id:string;room_type:string;role:string;ice_servers:any[]}>("testagram.media.token",{room_id:roomId,room_type:'call'})}
 listLiveAudioSpaces(){return this.call<CapabilityPage<any>>("testagram.audio_spaces.list_live",{})}
 getAudioSpace(spaceId:string){return this.call<{space:any}>("testagram.audio_spaces.get",{space_id:spaceId})}
 getMyAudioSpaceStatus(){return this.call<{items:any[]}>("testagram.audio_spaces.my_status",{})}
 getPendingAudioSpaceSpeakerRequests(spaceId:string){return this.call<{items:any[]}>("testagram.audio_spaces.pending_speaker_requests",{space_id:spaceId})}
 createAudioSpace(title:string,description='',maxAudience=1000){return this.call<{space_id:string;status:string;host_id:string}>("testagram.audio_spaces.create",{title,description,max_audience:maxAudience})}
 joinAudioSpace(spaceId:string){return this.call<{space_id:string;joined:boolean}>("testagram.audio_spaces.join",{space_id:spaceId})}
 leaveAudioSpace(spaceId:string){return this.call<{space_id:string;left:boolean}>("testagram.audio_spaces.leave",{space_id:spaceId})}
 requestAudioSpaceSpeaker(spaceId:string){return this.call<{space_id:string;status:string}>("testagram.audio_spaces.request_speaker",{space_id:spaceId})}
 decideAudioSpaceSpeaker(spaceId:string,userId:string,decision:'approved'|'denied'){return this.call<{space_id:string;user_id:string;status:string}>("testagram.audio_spaces.decide_speaker",{space_id:spaceId,user_id:userId,decision})}
 endAudioSpace(spaceId:string){return this.call<{space_id:string;ended:boolean}>("testagram.audio_spaces.end",{space_id:spaceId})}
 sendAudioSpaceSuperchat(spaceId:string,message:string,amount:number,idempotencyKey=rid()){return this.call<{transfer_id:string;status:string;duplicate:boolean}>("testagram.audio_spaces.superchat",{space_id:spaceId,message,amount,idempotency_key:idempotencyKey})}
}

export const backendCapabilities = new TestagramCapabilityClient({
 endpoint: CAPABILITY_GATEWAY_ENDPOINT,
 getAccessToken: async () => appwriteAuth.createBackendJWT(),
});
// Canonical capability client boundary: authenticated browser gateway only.
