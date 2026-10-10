const DB_NAME='testagram-feed-cache-v2';
const STORE='home-feed';
// Keep a bounded offline window; page size is six so this aligns with full feed pages.
export const HOME_FEED_CACHE_LIMIT=288;
const MAX_CACHE_AGE_MS=7*24*60*60*1000;
const FEDERATED_MAX_AGE_MS=24*60*60*1000;
import { warmOfflineFeedItems } from '@/lib/offlineMediaCache';
function isFreshHomeItem(item:any,now=Date.now()){
  if(item?.type!=='fedpost' && item?.data?.is_federated!==true)return true;
  const ts=Date.parse(String(item?.data?.created_at??item?.data?.published_at??item?.data?.published??''));
  return Number.isFinite(ts)&&ts>=now-FEDERATED_MAX_AGE_MS;
}
export function filterFreshHomeFeedItems(items:any[],now=Date.now()){return items.filter(item=>isFreshHomeItem(item,now));}

export type CachedFeed={key:string;items:any[];cursor:string|null;updatedAt:number;scrollY:number;anchorId:string|null};

function openFeedDb():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'key'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

export async function readHomeFeedCache(key='home'):Promise<CachedFeed|null>{
  if(typeof indexedDB==='undefined')return null;
  const db=await openFeedDb();
  return new Promise((resolve,reject)=>{
    const request=db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess=()=>resolve(request.result??null);
    request.onerror=()=>reject(request.error);
  });
}

export async function writeHomeFeedCache(value:CachedFeed,key='home'){
  if(typeof indexedDB==='undefined')return;
  const db=await openFeedDb();
  const items=filterFreshHomeFeedItems(value.items.filter(Boolean)).slice(0,HOME_FEED_CACHE_LIMIT);
  return new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put({...value,key,items});
    tx.oncomplete=()=>{ void warmOfflineFeedItems(items.slice(0, 24)); resolve(); }
    tx.onerror=()=>reject(tx.error);
  });
}

export function isHomeFeedCacheUsable(cache:CachedFeed|null,now=Date.now()){return Boolean(cache?.items?.length && Number.isFinite(cache.updatedAt) && now-cache.updatedAt<=MAX_CACHE_AGE_MS);}

export function mergeHomeFeedItems(existing:any[],incoming:any[],max=Number.MAX_SAFE_INTEGER){
  const seen=new Set<string>();
  const out:any[]=[];
  for(const item of filterFreshHomeFeedItems([...incoming,...existing])){
    const key=String(item?.type??'')+':'+String(item?.data?.id??item?.data?.uri??'');
    if(!key.endsWith(':')&&!seen.has(key)){seen.add(key);out.push(item);}
  }
  return out.slice(0,max);
}

export function saveHomeScroll(y:number,anchorId:string|null){
  if(typeof indexedDB==='undefined')return;
  // Update only scroll metadata; don't rewrite and re-warm every cached post on
  // each scroll event (the feed records can be large on long sessions).
  void openFeedDb().then(db=>new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    const store=tx.objectStore(STORE);
    const request=store.get('home');
    request.onsuccess=()=>{
      if(request.result)store.put({...request.result,scrollY:y,anchorId});
    };
    request.onerror=()=>reject(request.error);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  })).catch(()=>{});
}