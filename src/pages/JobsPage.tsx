import { useEffect, useState } from 'react';
import { Briefcase, CheckCircle2, Clock, FileText, Loader2, Send, ShieldCheck, UserCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { TopBar } from '@/components/layout/TopBar';
import { useGovernance, GOVERNANCE_ROLES } from '@/lib/governance';
import { supabase } from '@/lib/supabase';

type Job = { role_name:string; title:string; description:string; permissions:string[] };
type Application = { id:string; role_name:string; role_title:string; statement:string; status:string; review_note:string|null; created_at:string; updated_at:string };
type Invitation = { id:string; role_name:string; role_title:string; status:string; note:string|null; invited_at:string; responded_at:string|null };

export default function JobsPage() {
  const { governance } = useGovernance();
  const [jobs,setJobs]=useState<Job[]>([]);
  const [applications,setApplications]=useState<Application[]>([]);
  const [invitations,setInvitations]=useState<Invitation[]>([]);
  const [selected,setSelected]=useState('moderator');
  const [statement,setStatement]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);

  const load=async()=>{
    setLoading(true);
    try {
      const [j,a,i]=await Promise.all([
        supabase.rpc('testagram_list_open_jobs'),
        supabase.rpc('testagram_my_job_applications'),
        supabase.rpc('testagram_my_staff_invitations'),
      ]);
      if(j.error) throw j.error; if(a.error) throw a.error; if(i.error) throw i.error;
      setJobs(j.data??[]); setApplications(a.data??[]); setInvitations(i.data??[]);
    } catch(e:any){ toast.error(e?.message??'Could not load Testagram jobs'); }
    finally{setLoading(false);}
  };
  useEffect(()=>{void load();},[]);

  const apply=async()=>{
    if(!statement.trim()){toast.error('Add a short statement about why you want the role.');return;}
    setBusy(true);
    try{
      const {error}=await supabase.rpc('testagram_apply_for_job',{p_role_name:selected,p_statement:statement.trim()});
      if(error) throw error;
      toast.success('Application submitted to the Testagram owner');
      setStatement(''); await load();
    }catch(e:any){toast.error(e?.message??'Application failed');}
    finally{setBusy(false);}
  };

  const respond=async(id:string,accept:boolean)=>{
    setBusy(true);
    try{
      const {error}=await supabase.rpc('testagram_respond_staff_invitation',{p_invitation_id:id,p_accept:accept});
      if(error) throw error;
      toast.success(accept?'Invitation accepted — your staff workspace is ready':'Invitation declined');
      await load();
    }catch(e:any){toast.error(e?.message??'Could not respond to invitation');}
    finally{setBusy(false);}
  };

  return <div className="min-h-screen bg-background pb-20">
    <TopBar title="Testagram Jobs" showBack/>
    <div className="max-w-3xl mx-auto p-4 space-y-5">
      {invitations.length>0 && <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-4">
        <div className="flex gap-3"><div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><UserCheck/></div><div><h1 className="font-black text-lg">You have a Testagram staff invitation</h1><p className="text-sm text-muted-foreground">Your role features are already activated. Review the invitation and accept or decline it.</p></div></div>
        {invitations.map(i=><div key={i.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary"/><b>{i.role_title}</b><span className="text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary font-bold">ACTIVE ON PROFILE</span></div>
          {i.note&&<p className="text-sm mt-2 text-muted-foreground">{i.note}</p>}
          <div className="flex gap-2 mt-4"><button disabled={busy} onClick={()=>void respond(i.id,true)} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold">Accept</button><button disabled={busy} onClick={()=>void respond(i.id,false)} className="px-4 py-2 rounded-xl border border-border text-sm font-bold">Decline</button></div>
        </div>)}
      </section>}

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex gap-3 items-start"><Briefcase className="w-5 h-5 text-primary mt-1"/><div><h2 className="font-black text-xl">Work at Testagram</h2><p className="text-sm text-muted-foreground mt-1">Apply for an available Testagram governance role. Applications are reviewed by the system owner; applying never grants privileges by itself.</p></div></div>
        {loading?<div className="py-8 flex justify-center"><Loader2 className="animate-spin"/></div>:<div className="grid md:grid-cols-2 gap-3 mt-5">
          {jobs.map(j=><button key={j.role_name} onClick={()=>setSelected(j.role_name)} className={'text-left rounded-xl border p-4 transition-colors '+(selected===j.role_name?'border-primary bg-primary/5':'border-border hover:bg-muted')}>
            <p className="font-bold">{j.title}</p><p className="text-xs text-muted-foreground mt-1">{j.description}</p><p className="text-[10px] text-muted-foreground mt-3">{j.permissions.length} capabilities</p>
          </button>)}
        </div>}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2"><FileText className="w-5 h-5 text-primary"/><h2 className="font-bold">Apply for {GOVERNANCE_ROLES.find(r=>r.value===selected)?.label??selected}</h2></div>
        <textarea value={statement} onChange={e=>setStatement(e.target.value)} maxLength={4000} rows={6} placeholder="Tell the Testagram owner about your experience, availability and why you want this role…" className="w-full rounded-xl border border-border bg-background p-3 text-sm resize-y"/>
        <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{statement.length}/4000</span><button onClick={()=>void apply()} disabled={busy} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50">{busy?<Loader2 className="w-4 h-4 animate-spin"/>:<Send className="w-4 h-4"/>} Submit application</button></div>
      </section>

      {applications.length>0 && <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border"><h2 className="font-bold">My applications</h2></div>
        <div className="divide-y divide-border">{applications.map(a=><div key={a.id} className="p-4"><div className="flex items-center gap-2"><b>{a.role_title}</b><span className="text-xs px-2 py-1 rounded-full bg-muted font-semibold">{a.status}</span>{a.status==='accepted'?<CheckCircle2 className="w-4 h-4 text-primary"/>:a.status==='rejected'?<XCircle className="w-4 h-4 text-destructive"/>:<Clock className="w-4 h-4 text-muted-foreground"/>}</div><p className="text-xs text-muted-foreground mt-2">{new Date(a.created_at).toLocaleString()}</p>{a.review_note&&<p className="text-sm mt-2">{a.review_note}</p>}</div>)}</div>
      </section>}
      {governance.is_admin&&!governance.is_owner&&<button onClick={()=>location.assign('/staff')} className="w-full rounded-xl border border-primary/30 bg-primary/5 p-4 text-left font-bold text-primary">Open your Staff Workspace →</button>}
    </div>
  </div>;
}
