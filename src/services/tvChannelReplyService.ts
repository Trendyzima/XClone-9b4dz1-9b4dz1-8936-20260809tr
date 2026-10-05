import {supabase} from '@/lib/supabase';

export type TvReply={id:string;channel_id:string;user_id:string;content:string;created_at:string;profile?:{username?:string;display_name?:string;avatar_url?:string}|null};

export async function getTvReplies(channelId:string,limit=40):Promise<TvReply[]>{
 if(!channelId)return [];
 const {data,error}=await supabase.from('tv_channel_replies').select('id,channel_id,user_id,content,created_at,profile:profiles(username,display_name,avatar_url)').eq('channel_id',channelId).order('created_at',{ascending:false}).limit(limit);
 if(error)return [];
 return (data||[]) as unknown as TvReply[];
}

export async function createTvReply(channelId:string,userId:string,content:string):Promise<TvReply>{
 const clean=content.trim();
 if(!channelId||!userId||!clean)throw new Error('Reply is required');
 if(clean.length>1000)throw new Error('Reply is too long');
 const {data,error}=await supabase.from('tv_channel_replies').insert({channel_id:channelId,user_id:userId,content:clean}).select('id,channel_id,user_id,content,created_at,profile:profiles(username,display_name,avatar_url)').single();
 if(error)throw error;
 return data as unknown as TvReply;
}
