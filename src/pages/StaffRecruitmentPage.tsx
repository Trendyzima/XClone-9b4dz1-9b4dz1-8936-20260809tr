import { useEffect, useState } from 'react';
import { Briefcase, CheckCircle2, Loader2, UserPlus, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { TopBar } from '@/components/layout/TopBar';
import { listJobApplications, reviewJobApplication, inviteStaff, GOVERNANCE_ROLES, useGovernance } from '@/lib/governance';

export default function StaffRecruitmentPage(){
 const {governance,loading}=useGovernance();
 const [apps,setApps]=useState<any[]>([]); const [busy,setBusy]=useState<string|null>(null);
 const load=async()=>{try{setApps(await listJobApplications())}catch(e:any){toast.error(e?.message??'Could not load applications')}};
 useEffect(()=>{if(governance.is_owner)void load()},[governance.is_owner]);
 if(loading)return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin"/></div>;
 if(!governance.is_owner)return <div className="min-h-screen"><TopBar title="Staff Recruitment" showBack/><div className="p-6 text-center text-sm text-muted-foreground">Owner access required.</div></div>;
 const act=async(id:string,status:string)=>{setBusy(id);try{await reviewJobApplication(id,status);toast.success('Application updated');await load()}catch(e:any){toast.error(e?.message??'Update failed')}finally{setBusy(null)}};
 const invite=async(app:any)=>{setBusy(app.id);try{await inviteStaff(app.user_id,app.role_name,'Invitation following job application '+app.id);toast.success('@'+app.username+' invited and role activated');await load()}catch(e:any){toast.error(e?.message??'Invitation failed')}finally{setBusy(null)}};
 return <div className="min-h-screen bg-background pb-20"><TopBar title="Staff Recruitment" showBack/><div className="max-w-4xl mx-auto p-4 space-y-4">
  <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5"><div className="flex gap-3 items-center"><Briefcase className="w-7 h-7 text-primary"/><div><h1 className="font-black text-xl">Testagram Recruitment</h1><p className="text-sm text-muted-foreground">Review applications, then issue owner-controlled invitations. Applications never activate privileges.</p></div></div></section>
  {apps.length===0?<div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">No applications yet.</div>:apps.map(a=><article key={a.id} className="rounded-2xl border border-border bg-card p-5 space-y-3">
   <div className="flex items-start gap-3"><div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-bold">{a.username?.[0]?.toUpperCase()}</div><div className="flex-1"><div className="flex items-center gap-2"><b>@{a.username}</b><span className="text-xs text-muted-foreground">· {GOVERNANCE_ROLES.find(r=>r.value===a.role_name)?.label??a.role_name}</span><span className="ml-auto text-[10px] px-2 py-1 rounded-full bg-muted font-bold">{a.status}</span></div><p className="text-xs text-muted-foreground mt-1">{new Date(a.created_at).toLocaleString()}</p></div></div>
   <p className="text-sm whitespace-pre-wrap">{a.statement}</p>
   <div className="flex flex-wrap gap-2">{['reviewing','shortlisted','accepted','rejected'].map(s=><button key={s} disabled={!!busy} onClick={()=>void act(a.id,s)} className="px-3 py-2 rounded-xl border border-border text-xs font-bold">{s}</button>)}<button disabled={!!busy} onClick={()=>void invite(a)} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold inline-flex items-center gap-1.5"><UserPlus className="w-3.5 h-3.5"/> Invite & activate role</button></div>
  </article>)}
 </div></div>;
}