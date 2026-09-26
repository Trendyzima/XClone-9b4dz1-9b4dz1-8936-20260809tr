import {useEffect,useState} from 'react';
import {useNavigate,useParams} from 'react-router-dom';
import {ArrowLeft,Radio,Mic2,Users,Calendar,Play} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {supabase} from '@/lib/supabase';

export default function ChannelProfilePage(){
 const {handle}=useParams(); const nav=useNavigate(); const [channel,setChannel]=useState<any>(null); const [owner,setOwner]=useState<any>(null); const [loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;(async()=>{if(!handle)return;const {data,error}=await supabase.from('channel_profiles').select('*').eq('handle',handle).maybeSingle();if(!active)return;if(error||!data){setLoading(false);return;}setChannel(data);const {data:p}=await supabase.from('profiles').select('username,display_name,avatar_url').eq('id',data.owner_id).maybeSingle();if(active){setOwner(p);setLoading(false);}})();return()=>{active=false}},[handle]);
 if(loading)return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading channel…</div>;
 if(!channel)return <div className="min-h-screen grid place-items-center"><div className="text-center"><p className="font-bold">Channel not found</p><Button className="mt-3" onClick={()=>nav('/tv')}>Discover channels</Button></div></div>;
 const isTv=channel.channel_type==='tv';
 return <div className="min-h-screen bg-background">
  <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur"><div className="max-w-3xl mx-auto p-3 flex items-center gap-3"><Button size="icon" variant="ghost" onClick={()=>nav(-1)}><ArrowLeft/></Button><div className="font-bold">Channel profile</div></div></header>
  <main className="max-w-3xl mx-auto">
   <div className="h-36 sm:h-48 bg-muted overflow-hidden">{channel.banner_url&&<img src={channel.banner_url} className="w-full h-full object-cover" alt="" />}</div>
   <section className="px-4 pb-6">
    <div className="-mt-10 flex items-end justify-between gap-3"><div className="h-20 w-20 rounded-2xl border-4 border-background bg-muted overflow-hidden grid place-items-center">{channel.avatar_url?<img src={channel.avatar_url} className="w-full h-full object-cover" alt="" />:isTv?<Radio/>:<Mic2/>}</div><Button onClick={()=>nav(isTv?'/tv':'/spaces')}><Play className="w-4 h-4 mr-1"/>Discover live</Button></div>
    <h1 className="mt-3 text-2xl font-black">{channel.name}</h1><p className="text-sm text-muted-foreground">@{channel.handle}</p>
    {channel.bio&&<p className="mt-3">{channel.bio}</p>}
    <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground"><span className="flex items-center gap-1"><Users className="w-4 h-4"/>{channel.follower_count} followers</span><span className="capitalize">{channel.channel_type} channel</span>{channel.category&&<span>{channel.category}</span>}<span className="flex items-center gap-1"><Calendar className="w-4 h-4"/>Created {new Date(channel.created_at).toLocaleDateString()}</span></div>
    {owner&&<button className="mt-5 flex items-center gap-2 text-sm hover:underline" onClick={()=>owner.username&&nav('/profile/'+owner.username)}>{owner.avatar_url?<img src={owner.avatar_url} className="w-7 h-7 rounded-full" alt="" />:<span className="w-7 h-7 rounded-full bg-muted"/>}<span>Hosted by <b>{owner.display_name||owner.username}</b></span></button>}
    <div className="mt-7 rounded-2xl border p-4 bg-card"><div className="font-bold">About this channel</div><p className="text-sm text-muted-foreground mt-1">{isTv?'This Testagram TV channel broadcasts live only. Finished broadcasts are not stored as videos by Testagram.':'This Testagram audio channel hosts live conversations and spaces. Recordings follow the channel and host recording settings.'}</p></div>
   </section>
  </main>
 </div>;
}