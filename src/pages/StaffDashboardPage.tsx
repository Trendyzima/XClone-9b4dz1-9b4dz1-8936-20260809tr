import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, CheckCircle2, ClipboardList, MessageSquare, ShieldCheck, Users, Wallet, Radio, Globe, FileText, LockKeyhole, Crown } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { useGovernance, GOVERNANCE_ROLES } from '@/lib/governance';

const CAPABILITIES: Record<string,{label:string;icon:any;description:string;path?:string}>={
 'content.moderate':{label:'Content moderation',icon:ShieldCheck,description:'Review and enforce content policy.'},
 'reports.manage':{label:'Reports',icon:ClipboardList,description:'Review and resolve platform reports.'},
 'users.restrict':{label:'User restrictions',icon:Users,description:'Apply authorized account restrictions.'},
 'support.manage':{label:'Support operations',icon:MessageSquare,description:'Handle platform support workflows.'},
 'finance.read':{label:'Finance visibility',icon:Wallet,description:'View financial administration data.'},
 'finance.manage':{label:'Finance administration',icon:Wallet,description:'Perform authorized financial administration.'},
 'publishers.manage':{label:'Publisher operations',icon:FileText,description:'Manage publisher and editorial operations.'},
 'fediverse.manage':{label:'Fediverse operations',icon:Globe,description:'Operate federation controls.'},
 'live.manage':{label:'Live/media operations',icon:Radio,description:'Operate live and media controls.'},
 'system.read':{label:'System operations',icon:Activity,description:'View platform operational state.'},
 'system.manage':{label:'System management',icon:Activity,description:'Manage authorized platform configuration.'},
 'security.manage':{label:'Security controls',icon:LockKeyhole,description:'Manage privileged security controls.'},
 'governance.audit.read':{label:'Audit history',icon:ClipboardList,description:'Review governance audit records.'},
 'governance.admins.read':{label:'Staff directory',icon:Users,description:'View administrator assignments.'},
};
export default function StaffDashboardPage(){
 const navigate=useNavigate(); const {governance,loading}=useGovernance();
 const role=GOVERNANCE_ROLES.find(r=>r.value===governance.role);
 const caps=useMemo(()=>governance.permissions.map(p=>({key:p,...CAPABILITIES[p]})).filter(x=>x.label),[governance.permissions]);
 if(loading)return <div className="min-h-screen flex items-center justify-center"><Activity className="animate-pulse"/></div>;
 if(!governance.is_admin && !governance.is_owner)return <div className="min-h-screen"><TopBar title="Staff Workspace" showBack/><div className="max-w-xl mx-auto p-6 mt-10 rounded-2xl border border-border bg-card text-center"><LockKeyhole className="mx-auto w-8 h-8"/><h1 className="font-bold mt-3">Staff workspace locked</h1><p className="text-sm text-muted-foreground mt-2">The system owner must activate a staff assignment for this account.</p></div></div>;
 return <div className="min-h-screen bg-background pb-20"><TopBar title="Staff Workspace" showBack/><div className="max-w-4xl mx-auto p-4 space-y-5">
  <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5"><div className="flex gap-4 items-center"><div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><ShieldCheck className="w-7 h-7"/></div><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Testagram staff</p><h1 className="font-black text-2xl">{governance.is_owner ? 'System Owner' : (role?.label??governance.role)}</h1><p className="text-sm text-muted-foreground">{governance.is_owner ? 'Full Testagram platform access · Owner' : (role?.description??'Assigned governance role')+' · '+governance.status}</p></div></div></section>
  <section className="grid sm:grid-cols-3 gap-3">{[['Role status','Active owner',CheckCircle2],['Authority','Unrestricted',Crown],['Access model','System owner',ShieldCheck]].map(([a,b,I]:any)=><div key={a} className="rounded-2xl border border-border bg-card p-4"><I className="w-5 h-5 text-primary"/><p className="text-xs text-muted-foreground mt-3">{a}</p><p className="font-black mt-1">{b}</p></div>)}</section>
  <section className="rounded-2xl border border-primary/20 bg-card overflow-hidden"><div className="p-4 border-b border-border"><h2 className="font-bold">Owner command center</h2><p className="text-xs text-muted-foreground mt-1">You are the Testagram system owner. These are the current operational surfaces; owner authorization is not limited by the administrator permission list.</p></div><div className="grid md:grid-cols-2">{caps.map(({key,label,icon:Icon,description})=><div key={key} className="p-4 border-b border-border md:[&:nth-child(odd)]:border-r"><div className="flex gap-3"><div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-4 h-4"/></div><div className="flex-1"><p className="font-bold text-sm">{label}</p><p className="text-xs text-muted-foreground mt-1">{description}</p><span className="inline-flex mt-2 text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary font-bold">OWNER AUTHORITY</span></div></div></div>)}</div></section>
  <section className="grid sm:grid-cols-2 gap-3"><button onClick={()=>navigate('/team-chat')} className="rounded-2xl border border-border bg-card p-4 text-left hover:bg-muted"><MessageSquare className="w-5 h-5"/><p className="font-bold mt-2">Staff Team Chat</p><p className="text-xs text-muted-foreground mt-1">Coordinate with the Testagram team.</p><ArrowRight className="w-4 h-4 mt-3"/></button><button onClick={()=>navigate('/jobs')} className="rounded-2xl border border-border bg-card p-4 text-left hover:bg-muted"><ClipboardList className="w-5 h-5"/><p className="font-bold mt-2">Jobs & applications</p><p className="text-xs text-muted-foreground mt-1">Review your invitation and application history.</p><ArrowRight className="w-4 h-4 mt-3"/></button></section>
 </div></div>;
}
