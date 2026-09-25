import { supabase, supabasePublishableKey, supabaseUrl } from '@/lib/supabase';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';
export type CapabilityError={code:string;message:string};
export type CapabilityResponse<T>={ok:boolean;data:T|null;error:CapabilityError|null;request_id:string};
export type CapabilityPage<T>={items:T[];next_cursor:string|null};
export type SearchDiscoveryPage={users:any[];hashtags:any[];posts:any[];communities:any[];next_cursor:string|null};
export type LikeState={is_liked:boolean;likes_count:number};
export type RepostState={is_reposted:boolean;reposts_count:number};
export type FollowState={following:boolean;requested:boolean;followed_by?:boolean;status?:string;following_id?:string};
export type NotificationItem={id:string;recipient_id:string;actor_id:string|null;kind:string;post_id:string|null;read_at:string|null;created_at:string;data:Record<string,unknown>|null;priority:string|null;category:string|null;group_key:string|null;action_url:string|null;expires_at:string|null;archived_at:string|null;dedupe_key:string|null;actor:{id:string;username:string|null;display_name:string|null;avatar_url:string|null;verified:boolean}|null};
export type PushConfig={public_key:string;subject:string};
export type NotificationPreference={id:string;user_id:string;notif_type:string;in_app:boolean;push:boolean;email:boolean;sound_enabled:boolean;vibration_enabled:boolean;digest_frequency:string;quiet_hours_start:string|null;quiet_hours_end:string|null;timezone:string;muted_until:string|null;updated_at:string};
export type TestagramCapabilityClientOptions={endpoint:string;getAccessToken:()=>Promise<string|null>;clientName?:string;clientVersion?:string;timeoutMs?:number;apiKey?:string};
export class CapabilityClientError extends Error{readonly code:string;readonly requestId:string|null;readonly status:number|null;constructor(message:string,o:{code?:string;requestId?:string|null;status?:number|null}={}){super(message);this.name="CapabilityClientError";this.code=o.code??"CAPABILITY_REQUEST_FAILED";this.requestId=o.requestId??null;this.status=o.status??null;}}
// Only registry capabilities marked access: "public" may use the unauthenticated
// same-origin edge path. Search, timelines, trends and all account-bound reads
// remain authenticated and therefore bypass CDN caching.
const PUBLIC_CAPABILITIES=new Set(["testagram.capabilities.list","testagram.health.read"]);
const EDGE_CAPABILITY_PATH="/api/capability";
// Keep every capability call on the same browser Supabase configuration used by Auth.
// This prevents profile/search paths from falling back to a stale VITE_* key.
const CAPABILITY_GATEWAY_ENDPOINT="/api/capability";
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
 private endpoint:string;private token:()=>Promise<string|null>;private name:string;private version:string;private timeout:number;private apiKey:string;
 constructor(o:TestagramCapabilityClientOptions){if(!o.endpoint?.trim())throw new Error("Capability endpoint is required");this.endpoint=o.endpoint.replace(/\/$/,"");this.token=o.getAccessToken;this.name=o.clientName??"testagram-client";this.version=o.clientVersion??"2";this.timeout=Math.min(30000,Math.max(1000,Math.floor(o.timeoutMs??15000)));this.apiKey=o.apiKey??"";}
 private async request<T>(capability:string,input:Record<string,unknown>,token:string|null,id:string,ctl:AbortController){
  // Send the session JWT explicitly to PostgREST. The previous implementation
  // called supabase.rpc(), which relies on the client's mutable auth header. A
  // valid useAuth() user can therefore race Auth hydration and reach the RPC as
  // anon. Explicit Authorization makes the browser identity deterministic.
  const headers: Record<string,string> = {
    apikey: supabasePublishableKey,
    Authorization: token ? `Bearer ${token}` : `Bearer ${supabasePublishableKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Client-Info': `testagram-web/${this.version}`,
  };
  try {
    // Route authenticated capability calls through the canonical Vercel gateway.
    // This keeps capability dispatch on the same server-side auth boundary as media
    // uploads and avoids browser/PostgREST auth-header races after large uploads.
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ capability, input }),
      signal: ctl.signal,
      credentials: 'same-origin',
    });
    const raw = await response.text();
    let data: unknown = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!response.ok) {
      const message = typeof data === 'object' && data && 'message' in data
        ? String((data as { message?: unknown }).message)
        : response.status === 401 || response.status === 403
          ? 'Authentication required'
          : 'Capability database request failed';
      const auth = response.status === 401 || response.status === 403 || /authentication required|jwt|token/i.test(message);
      return {
        r: response,
        p: {
          ok: false,
          data: null,
          error: { code: auth ? 'AUTH_REQUIRED' : 'CAPABILITY_DISPATCH_FAILED', message },
          request_id: id,
        },
      };
    }
    return {
      r: response,
      p: { ok: true, data: data as T, error: null, request_id: id },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
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
        const refreshed=await supabase.auth.refreshSession();
        token=refreshed.data.session?.access_token??null;
        if(token)continue;
      }
      // Authenticated content writes get a direct Supabase RPC fallback. Threads
      // already use the canonical Supabase REST boundary successfully; keeping
      // post creation on the same project/auth plane avoids a Vercel gateway
      // header race turning a valid user session into auth.uid() = null.
      if(!isPublic && capability==="testagram.posts.create" && token){
        try{
          const directResponse=await fetch(`${supabaseUrl.replace(/\/$/,"")}/rest/v1/rpc/capability_dispatch`,{
            method:"POST",
            headers:{apikey:supabasePublishableKey,Authorization:`Bearer ${token}`,"Content-Type":"application/json",Accept:"application/json"},
            body:JSON.stringify({p_capability:capability,p_input:input}),
          });
          const directRaw=await directResponse.text();
          let directData:unknown=null; try{directData=directRaw?JSON.parse(directRaw):null;}catch{}
          if(directResponse.ok){
            return directData as T;
          }
          const directMessage=typeof directData==="object"&&directData&&"message" in directData?String((directData as {message?:unknown}).message):`Post creation failed (${directResponse.status})`;
          throw new CapabilityClientError(directMessage,{code:directResponse.status===401||directResponse.status===403?"AUTH_REQUIRED":"CAPABILITY_DISPATCH_FAILED",requestId:id,status:directResponse.status});
        }catch(directError){
          if(directError instanceof CapabilityClientError)throw directError;
        }
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
 listPosts(n=20,c?:string){return this.call<CapabilityPage<unknown>>("testagram.posts.list",{limit:limit(n),...cursor(c)})}
 searchPosts(q:string,n=20,c?:string,options:{mediaOnly?:boolean;verifiedOnly?:boolean}={}){return this.call<CapabilityPage<any>>("testagram.search.posts",{q,limit:limit(n),...options.mediaOnly?{media_only:true}:{},...options.verifiedOnly?{verified_only:true}:{},...cursor(c)})}
 searchUsers(q:string,n=20,c?:string){return this.call<CapabilityPage<any>>("testagram.search.users",{q,limit:limit(n),...cursor(c)})}
 searchHashtags(q:string,n=20,c?:string){return this.call<CapabilityPage<any>>("testagram.search.hashtags",{q,limit:limit(n),...cursor(c)})}
 async searchUnified(q:string,kind:"all"|"people"|"posts"|"hashtags"|"threads"|"communities"|"fediverse"|"media"|"latest"|"top"="all",n=40){
  const input={q,kind,limit:limit(n)};
  const token=await this.token();
  if(!token) throw new CapabilityClientError("Authentication required",{code:"AUTH_REQUIRED",status:401});
  const directUrl=`${supabaseUrl.replace(/\\/$/,"")}/rest/v1/rpc/testagram_search_unified`;
  const directHeaders={apikey:supabasePublishableKey,Authorization:`Bearer ${token}`,"Content-Type":"application/json",Accept:"application/json"};
  let directFailure:unknown=null;
  try{
    const response=await fetch(directUrl,{method:"POST",headers:directHeaders,body:JSON.stringify({p_q:q,p_kind:kind,p_limit:limit(n)})});
    const raw=await response.text();
    let payload:any=null; try{payload=raw?JSON.parse(raw):null}catch{}
    if(response.ok){
      return {users:Array.isArray(payload?.users)?payload.users:[],hashtags:Array.isArray(payload?.hashtags)?payload.hashtags:[],posts:Array.isArray(payload?.posts)?payload.posts:[],threads:Array.isArray(payload?.threads)?payload.threads:[],communities:Array.isArray(payload?.communities)?payload.communities:[],replies:Array.isArray(payload?.replies)?payload.replies:[],fediverse:Array.isArray(payload?.fediverse)?payload.fediverse:[],next_cursor:payload?.next_cursor??null};
    }
    directFailure=new CapabilityClientError(payload&&typeof payload==="object"&&"message" in payload?String(payload.message):`Search request failed (${response.status})`,{code:response.status===401||response.status===403?"AUTH_REQUIRED":"SEARCH_RPC_FAILED",status:response.status});
  }catch(e){directFailure=e;}
  try{
    const gateway=await this.call<any>("testagram.search.unified",input,token);
    return {users:Array.isArray(gateway?.users)?gateway.users:[],hashtags:Array.isArray(gateway?.hashtags)?gateway.hashtags:[],posts:Array.isArray(gateway?.posts)?gateway.posts:[],threads:Array.isArray(gateway?.threads)?gateway.threads:[],communities:Array.isArray(gateway?.communities)?gateway.communities:[],replies:Array.isArray(gateway?.replies)?gateway.replies:[],fediverse:Array.isArray(gateway?.fediverse)?gateway.fediverse:[],next_cursor:gateway?.next_cursor??null};
  }catch(gatewayError){
    if(gatewayError instanceof CapabilityClientError) throw gatewayError;
    if(directFailure instanceof CapabilityClientError) throw directFailure;
    throw gatewayError;
  }
}
 searchCommunities(q:string,n=20,c?:string){return this.call<CapabilityPage<any>>("testagram.search.communities",{q,limit:limit(n),...cursor(c)})}
 async searchDiscovery(_endpoint:string,q:string,mode:"search"|"suggest"="search",n=20,c?:string):Promise<SearchDiscoveryPage>{const size=limit(mode==="suggest"?Math.min(n,8):n);const normalized=q.trim().replace(/^[@#]/,'');const [users,hashtags,posts,communities]=await Promise.all([this.searchUsers(normalized,size,c),this.searchHashtags(normalized,size,c),this.searchPosts(q.trim(),size,c),this.searchCommunities(normalized,size,c)]);return{users:users.items,hashtags:hashtags.items,posts:posts.items,communities:communities.items,next_cursor:posts.next_cursor};}
 createPost(input:{body?:string;content?:string;communityId?:string;mediaUrl?:string;mediaType?:string;mediaUrls?:string[];imageUrl?:string;videoUrl?:string;isVideo?:boolean;mediaCount?:number;visibility?:string;replyToPostId?:string;quotedPostId?:string;quotePostId?:string;quoteOfPostId?:string;poll?:{question:string;options:string[];durationMinutes?:number;multipleChoice?:boolean};productIds?:string[]},accessToken?:string){return this.call<{post_id:string;poll_id?:string|null;created:boolean}>("testagram.posts.create",{body:input.body??input.content??"",content:input.content??input.body??"",...input.communityId?{community_id:input.communityId}:{},...input.mediaUrl?{media_url:input.mediaUrl}:{},...input.mediaType?{media_type:input.mediaType}:{},...input.mediaUrls?{media_urls:input.mediaUrls}:{},...input.imageUrl?{image_url:input.imageUrl}:{},...input.videoUrl?{video_url:input.videoUrl}:{},...(input.isVideo!==undefined?{is_video:input.isVideo}:{}),...(input.mediaCount!==undefined?{media_count:input.mediaCount}:{}),...input.visibility?{visibility:input.visibility}:{},...input.replyToPostId?{reply_to_post_id:input.replyToPostId}:{},...input.quotedPostId?{quoted_post_id:input.quotedPostId}:{},...input.quotePostId?{quote_post_id:input.quotePostId}:{},...input.quoteOfPostId?{quote_of_post_id:input.quoteOfPostId}:{},...input.poll?{poll:{question:input.poll.question,options:input.poll.options,...input.poll.durationMinutes!==undefined?{duration_minutes:input.poll.durationMinutes}:{},...(input.poll.multipleChoice!==undefined?{multiple_choice:input.poll.multipleChoice}:{})}}:{},...input.productIds?{product_ids:input.productIds}:{}},accessToken)}
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
 listBookmarks(n=20,c?:string){return this.call<CapabilityPage<unknown>>("testagram.bookmarks.list",{limit:limit(n),...cursor(c)})} bookmarkPost(postId:string){return this.call<{bookmark:unknown}>("testagram.bookmarks.add",{post_id:postId})} removeBookmark(postId:string){return this.call<{removed:boolean}>("testagram.bookmarks.remove",{post_id:postId})} listBookmarkFolders(){return this.call<{items:unknown[]}>("testagram.bookmarks.folders.list")} createBookmarkFolder(name:string){return this.call<{folder:unknown}>("testagram.bookmarks.folders.create",{name})}
 getTrends(n=20){return this.call<{items:unknown[]}>("testagram.trends.list",{limit:limit(n)})} getProfileTimeline(userId:string,n=20,c?:string){return this.call<CapabilityPage<any>>("testagram.profile.timeline",{user_id:userId,limit:limit(n),...cursor(c)})} followUser(userId:string,follow=true){return this.call<{state:FollowState}>("testagram.follows.set",{user_id:userId,follow})} getFollowState(userId:string){return this.call<{state:FollowState}>("testagram.follows.state",{user_id:userId})} listFollowRequests(n=20,c?:string){return this.call<CapabilityPage<any>>("testagram.follow_requests.list",{limit:limit(n),...cursor(c)})} respondFollowRequest(requesterId:string,action:"accept"|"reject"){return this.call<{requester_id:string;target_id:string;action:string;status:string}>("testagram.follow_requests.respond",{requester_id:requesterId,action})} likePost(postId:string){return this.call<{state:LikeState}>("testagram.posts.like",{post_id:postId})} quotePost(quotedPostId:string,content:string){return this.createPost({content,quotedPostId})} getLikeState(postId:string){return this.call<{state:LikeState}>("testagram.posts.like.state",{post_id:postId})} repostPost(postId:string){return this.call<{state:RepostState}>("testagram.posts.repost",{post_id:postId})} getRepostState(postId:string){return this.call<{state:RepostState}>("testagram.posts.repost.state",{post_id:postId})} listReplies(postId:string,n=50){return this.call<CapabilityPage<any>>("testagram.replies.list",{post_id:postId,limit:limit(n)})} createReply(postId:string,content:string,parentReplyId?:string){return this.call<{reply_id:string;created:boolean;replies_count?:number}>("testagram.replies.create",{post_id:postId,content,...parentReplyId?{parent_reply_id:parentReplyId}:{}})}
 listMedia(n=20,c?:string){return this.call<CapabilityPage<unknown>>("testagram.media.list",{limit:limit(n),...cursor(c)})} attachMedia(postId:string,mediaAssetId:string,sortOrder=0){return this.call<{media:unknown}>("testagram.media.attach",{post_id:postId,media_asset_id:mediaAssetId,sort_order:sortOrder})}
 listCommunities(n=20){return this.call<{items:unknown[]}>("testagram.communities.list",{limit:limit(n)})} createCommunity(name:string,options:Record<string,unknown>={}){return this.call<{community:unknown}>("testagram.communities.create",{name,...options})} joinCommunity(communityId:string){return this.call<{membership:unknown}>("testagram.communities.join",{community_id:communityId})} leaveCommunity(communityId:string){return this.call<{membership:unknown}>("testagram.communities.leave",{community_id:communityId})}
 getFederationStatus(n=20,c?:string){return this.call<CapabilityPage<unknown>>("testagram.federation.status",{limit:limit(n),...cursor(c)})} getWallet(n=20,c?:string){return this.call<{wallet:unknown;transactions:unknown[];next_cursor:string|null}>("testagram.wallet.read",{limit:limit(n),...cursor(c)})} getWalletTransactions(n=20,c?:string){return this.getWallet(n,c).then(x=>({items:x.transactions,next_cursor:x.next_cursor}))}
}

export const backendCapabilities = new TestagramCapabilityClient({
 endpoint: CAPABILITY_GATEWAY_ENDPOINT,
 getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
 apiKey: supabasePublishableKey,
});
// Canonical capability client boundary: authenticated browser gateway only.
