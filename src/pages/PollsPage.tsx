import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { TopBar } from '@/components/layout/TopBar';
import { BarChart3, Plus, Loader2, CheckCircle2, Clock3, Users, Home, X } from 'lucide-react';
import { toast } from 'sonner';

type PollOption={id:string;label:string;position:number;votes:number};
type Poll={id:string;question:string;description?:string;status:string;ends_at?:string|null;total_votes:number;options:PollOption[];has_voted?:boolean};

function PollCard({poll,onVoted}:{poll:Poll;onVoted:()=>void}){
 const {user}=useAuth(); const [selected,setSelected]=useState<string[]>([]); const [busy,setBusy]=useState(false);
 const vote=async()=>{if(!user){toast.error('Sign in to vote');return} if(!selected.length)return;
  setBusy(true); const {error}=await supabase.rpc('cast_poll_vote',{p_poll_id:poll.id,p_option_ids:selected});
  if(error)toast.error(error.message); else {toast.success('Vote recorded');onVoted()} setBusy(false);
 };
 const total=Math.max(1,poll.total_votes);
 return <article className="rounded-2xl border border-border bg-card p-4 space-y-4">
  <div className="flex items-start gap-3"><div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><BarChart3 className="w-4 h-4"/></div><div className="flex-1"><h2 className="font-bold leading-snug">{poll.question}</h2>{poll.description&&<p className="text-xs text-muted-foreground mt-1">{poll.description}</p>}</div></div>
  <div className="space-y-2">{poll.options.map(o=>{const pct=Math.round((o.votes/total)*100);const chosen=selected.includes(o.id);return <button key={o.id} disabled={busy||poll.status!=='open'} onClick={()=>setSelected(s=>poll.options.length&&false? s : (poll.options.length? (chosen?s.filter(x=>x!==o.id):poll.options.length===0?s:[...s,o.id]):s))} className="w-full text-left rounded-xl border border-border p-3 relative overflow-hidden hover:border-primary/50 transition-colors"><div className="absolute inset-y-0 left-0 bg-primary/10" style={{width:`${pct}%`}}/><span className="relative flex items-center justify-between gap-3"><span className={chosen?'font-bold text-primary':'font-medium'}>{chosen?'✓ ':''}{o.label}</span><span className="text-xs text-muted-foreground">{pct}% · {o.votes}</span></span></button>})}</div>
  <div className="flex items-center justify-between text-xs text-muted-foreground"><span className="flex items-center gap-1"><Users className="w-3.5 h-3.5"/>{poll.total_votes} vote{poll.total_votes===1?'':'s'}</span>{poll.ends_at?<span className="flex items-center gap-1"><Clock3 className="w-3.5 h-3.5"/>{new Date(poll.ends_at).toLocaleString()}</span>:<span>Open voting</span>}</div>
  {poll.status==='open'&&<button disabled={busy||!selected.length} onClick={vote} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-40 flex items-center justify-center gap-2">{busy?<Loader2 className="w-4 h-4 animate-spin"/>:<CheckCircle2 className="w-4 h-4"/>}Cast vote</button>}
 </article>
}

export default function PollsPage(){
 const {user}=useAuth(); const navigate=useNavigate(); const [polls,setPolls]=useState<Poll[]>([]); const [loading,setLoading]=useState(true); const [creating,setCreating]=useState(false); const [question,setQuestion]=useState(''); const [description,setDescription]=useState(''); const [answers,setAnswers]=useState(['','']); const [endsAt,setEndsAt]=useState('');
 const load=async()=>{setLoading(true);const {data,error}=await supabase.from('polls').select('id,question,description,status,ends_at').order('created_at',{ascending:false}).limit(20);if(error){toast.error(error.message);setLoading(false);return}const rows=await Promise.all((data??[]).map(async p=>{const {data:r}=await supabase.rpc('poll_results',{p_poll_id:p.id});const x=r as any;return {...p,total_votes:Number(x?.total_votes??0),options:(x?.options??[]) as PollOption[]}}));setPolls(rows);setLoading(false)};
 useEffect(()=>{load()},[]);
 const create=async()=>{const opts=answers.map(x=>x.trim()).filter(Boolean);if(question.trim().length<5||opts.length<2){toast.error('Add a clear question and at least 2 answers');return}setCreating(true);const {error}=await supabase.rpc('create_poll',{p_question:question.trim(),p_options:opts,p_description:description.trim()||null,p_ends_at:endsAt?new Date(endsAt).toISOString():null,p_allow_multiple:false,p_visibility:'public'});if(error)toast.error(error.message);else{toast.success('Poll published');setQuestion('');setDescription('');setAnswers(['','']);setEndsAt('');await load()}setCreating(false)};
 return <div className="min-h-screen bg-background pb-16 lg:pb-0"><TopBar title="Polls"/><div className="p-4 space-y-5">
  <div className="flex items-center gap-2"><button onClick={()=>navigate('/')} className="p-2 rounded-xl hover:bg-muted"><Home className="w-4 h-4"/></button><div><h1 className="text-xl font-black">Community Polls</h1><p className="text-xs text-muted-foreground">Ask a question, collect answers, and publish transparent vote totals.</p></div></div>
  {user&&<section className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3"><div className="flex items-center gap-2 font-bold"><Plus className="w-4 h-4"/>Create a poll</div><input value={question} onChange={e=>setQuestion(e.target.value)} maxLength={500} placeholder="What should the community decide?" className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"/><textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={1000} placeholder="Context (optional)" rows={2} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm resize-none"/><div className="space-y-2">{answers.map((a,i)=><div key={i} className="flex gap-2"><input value={a} onChange={e=>setAnswers(xs=>xs.map((x,j)=>j===i?e.target.value:x))} maxLength={200} placeholder={`Answer ${i+1}`} className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm"/>{answers.length>2&&<button onClick={()=>setAnswers(xs=>xs.filter((_,j)=>j!==i))} className="p-2 text-muted-foreground"><X className="w-4 h-4"/></button>}</div>)}</div><button disabled={answers.length>=8} onClick={()=>setAnswers(x=>[...x,''])} className="text-xs font-bold text-primary disabled:opacity-40">+ Add answer</button><div><label className="text-xs font-semibold text-muted-foreground">Voting closes (optional)</label><input type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"/></div><button onClick={create} disabled={creating} className="w-full rounded-xl bg-primary text-primary-foreground py-2.5 font-bold flex justify-center gap-2">{creating?<Loader2 className="w-4 h-4 animate-spin"/>:<Plus className="w-4 h-4"/>}Publish poll</button></section>}
  {loading?<div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin"/></div>:polls.length?<div className="space-y-3">{polls.map(p=><PollCard key={p.id} poll={p} onVoted={load}/>)}</div>:<div className="text-center py-16 text-muted-foreground">No public polls yet. Be the first to ask a question.</div>}
 </div></div>
}
