import {supabase} from '@/lib/supabase';
import {readPublicWithFallback} from '@/lib/dataPlane';

export const TV_REACTIONS=['❤️','🔥','👏','😂','😮','😢'];

export type TvReactionCounts={emoji:string;count:number}[];

export async function getTvReactionCounts(channelId:string):Promise<TvReactionCounts>{
  if(!channelId)return [];
  const result=await readPublicWithFallback(
    'tv_channel_reactions',
    (client)=>client.from('tv_channel_reactions').select('emoji').eq('channel_id',channelId),
    (client)=>client.from('tv_channel_reactions').select('emoji').eq('channel_id',channelId),
  );
  const data=result.data as any[] | null;
  if(result.primaryError && result.source==='primary')return [];
  const counts=new Map<string,number>();
  (data||[]).forEach((row:any)=>counts.set(String(row.emoji),Number(counts.get(String(row.emoji))||0)+1));
  return Array.from(counts.entries()).map(([emoji,count])=>({emoji,count})).sort((a,b)=>b.count-a.count);
}

export async function getMyTvReaction(channelId:string,userId?:string):Promise<string|null>{
  if(!channelId||!userId)return null;
  const {data,error}=await supabase.from('tv_channel_reactions').select('emoji').eq('channel_id',channelId).eq('user_id',userId).maybeSingle();
  if(error)return null;
  return data?.emoji?String(data.emoji):null;
}

export async function setTvReaction(channelId:string,userId:string,emoji:string,current:string|null):Promise<string|null>{
  if(!channelId||!userId)return null;
  if(current===emoji){
    const {error}=await supabase.from('tv_channel_reactions').delete().eq('channel_id',channelId).eq('user_id',userId);
    if(error)throw error;
    return null;
  }
  const {error}=await supabase.from('tv_channel_reactions').upsert(
    {channel_id:channelId,user_id:userId,emoji},
    {onConflict:'channel_id,user_id'}
  );
  if(error)throw error;
  return emoji;
}
