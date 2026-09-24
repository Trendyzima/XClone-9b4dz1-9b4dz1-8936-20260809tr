const DB_NAME='testagram-feed-cache-v2';
const STORE='home-feed';
const MAX_ITEMS=80;

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
  const items=value.items.filter(Boolean).slice(0,MAX_ITEMS);
  return new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put({...value,key,items});
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

export function mergeHomeFeedItems(existing:any[],incoming:any[],max=MAX_ITEMS){
  const seen=new Set<string>();
  const out:any[]=[];
  for(const item of [...incoming,...existing]){
    const key=String(item?.type??'')+':'+String(item?.data?.id??item?.data?.uri??'');
    if(!key.endsWith(':')&&!seen.has(key)){seen.add(key);out.push(item);}
  }
  return out.slice(0,max);
}

export function saveHomeScroll(y:number,anchorId:string|null){
  void readHomeFeedCache().then(c=>c&&writeHomeFeedCache({...c,scrollY:y,anchorId})).catch(()=>{});
}