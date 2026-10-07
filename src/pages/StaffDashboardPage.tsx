import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, CheckCircle2, ClipboardList, MessageSquare, ShieldCheck, Users, Wallet, Radio, Globe, FileText, LockKeyhole, Crown, KeyRound, RefreshCw, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { TopBar } from '@/components/layout/TopBar';
import {
  useGovernance, GOVERNANCE_ROLES, verifyStaffWorkspacePin, setStaffWorkspacePin,
  getAuthenticatedUserId, changeStaffWorkspacePin, requestStaffWorkspacePinReset,
  confirmStaffWorkspacePinReset,
} from '@/lib/governance';

const CAPABILITIES: Record<string,{label:string;icon:any;description:string;path:string}>= {
 'content.moderate':{label:'Content moderation',icon:ShieldCheck,description:'Review and enforce content policy.',path:'/regulator/moderation'},
 'reports.manage':{label:'Reports',icon:ClipboardList,description:'Review and resolve platform reports.',path:'/regulator/reports'},
 'users.restrict':{label:'User restrictions',icon:Users,description:'Apply authorized account restrictions.',path:'/admin/users'},
 'support.manage':{label:'Support operations',icon:MessageSquare,description:'Handle platform support workflows.',path:'/team-chat'},
 'finance.read':{label:'Finance visibility',icon:Wallet,description:'View financial administration data.',path:'/admin/revenue'},
 'finance.manage':{label:'Finance administration',icon:Wallet,description:'Perform authorized financial administration.',path:'/admin/platform-revenue'},
 'publishers.manage':{label:'Publisher operations',icon:FileText,description:'Manage publisher and editorial operations.',path:'/creator-studio'},
 'fediverse.manage':{label:'Fediverse operations',icon:Globe,description:'Operate federation controls.',path:'/fediverse/controls'},
 'live.manage':{label:'Live/media operations',icon:Radio,description:'Operate live and media controls.',path:'/tv-studio'},
 'system.read':{label:'System operations',icon:Activity,description:'View platform operational state.',path:'/analytics'},
 'system.manage':{label:'System management',icon:Activity,description:'Manage authorized platform configuration.',path:'/regulator/platform'},
 'security.manage':{label:'Security controls',icon:LockKeyhole,description:'Manage privileged security controls.',path:'/regulator/platform'},
 'governance.audit.read':{label:'Audit history',icon:ClipboardList,description:'Review governance audit records.',path:'/regulator/audit'},
 'governance.admins.manage':{label:'Administrator management',icon:Users,description:'Appoint, change, suspend, and revoke administrators.',path:'/admin/governance'},
 'governance.admins.read':{label:'Staff directory',icon:Users,description:'View administrator assignments.',path:'/admin/governance'},
 'governance.read':{label:'Governance status',icon:ShieldCheck,description:'View governance status and administration surfaces.',path:'/admin/governance'},
 'governance.roles.manage':{label:'Governance roles',icon:Crown,description:'Manage governance roles and permission mappings.',path:'/admin/governance'},
 'users.read':{label:'User administration',icon:Users,description:'View platform user records in administrative surfaces.',path:'/admin/users'},
};

export default function StaffDashboardPage(){
 const navigate=useNavigate(); const {governance,loading}=useGovernance();
 const [pin,setPin]=useState(''); const [pinBusy,setPinBusy]=useState(false); const [pinUnlocked,setPinUnlocked]=useState(false);
 const [initialPin,setInitialPin]=useState(''); const [initialPinConfirm,setInitialPinConfirm]=useState('');
 const [currentPin,setCurrentPin]=useState(''); const [newPin,setNewPin]=useState(''); const [newPinConfirm,setNewPinConfirm]=useState('');
 const [resetCode,setResetCode]=useState(''); const [resetPin,setResetPin]=useState(''); const [resetPinConfirm,setResetPinConfirm]=useState('');
 const [resetRequestId,setResetRequestId]=useState<string|null>(null); const [securityBusy,setSecurityBusy]=useState(false);
 const role=GOVERNANCE_ROLES.find(r=>r.value===governance.role);
 const caps=useMemo(()=>governance.permissions.map(p=>({key:p,...CAPABILITIES[p]})).filter(x=>x.label),[governance.permissions]);
 const canOpen=governance.is_admin || governance.is_owner || pinUnlocked;

 const verifyPin=async()=>{
  setPinBusy(true);
  try{const result=await verifyStaffWorkspacePin(pin); if(result.success){setPinUnlocked(true);setPin('');toast.success('Staff Workspace unlocked');}
  else{const suffix=typeof result.attempts_remaining==='number'?' · '+result.attempts_remaining+' attempts remaining':'';toast.error(result.code==='PIN_LOCKED'?'PIN temporarily locked':result.code==='PIN_NOT_SET'?'No PIN is set yet. Use Set initial PIN below.':'Incorrect PIN'+suffix);}}
  catch(e:any){toast.error(e?.message??'Could not verify PIN')} finally{setPinBusy(false);}
 };

 const initializePin=async()=>{
  if(initialPin.length<4||initialPin!==initialPinConfirm)return toast.error('Enter matching 4–6 digit PINs');
  setSecurityBusy(true);
  try{const id=await getAuthenticatedUserId();await setStaffWorkspacePin(id,initialPin);setInitialPin('');setInitialPinConfirm('');toast.success('PIN set. Security notification sent to the system mailbox.');}
  catch(e:any){toast.error(e?.message??'Could not set PIN')}finally{setSecurityBusy(false);}
 };

 const changePin=async()=>{
  if(newPin.length<4||newPin!==newPinConfirm)return toast.error('Enter matching 4–6 digit new PINs');
  setSecurityBusy(true);
  try{await changeStaffWorkspacePin(currentPin,newPin);setCurrentPin('');setNewPin('');setNewPinConfirm('');toast.success('PIN changed. Security notification sent.');}
  catch(e:any){toast.error(e?.message??'Could not change PIN')}finally{setSecurityBusy(false);}
 };

 const requestReset=async()=>{
  setSecurityBusy(true);
  try{const r=await requestStaffWorkspacePinReset();setResetRequestId(r.request_id);setResetCode('');toast.success('A reset confirmation code was sent to the system security mailbox.');}
  catch(e:any){toast.error(e?.message??'Could not request PIN reset')}finally{setSecurityBusy(false);}
 };

 const confirmReset=async()=>{
  if(!resetRequestId)return;
  if(resetCode.length!==6||resetPin.length<4||resetPin!==resetPinConfirm)return toast.error('Enter the 6-digit confirmation code and matching 4–6 digit PINs');
  setSecurityBusy(true);
  try{await confirmStaffWorkspacePinReset(resetRequestId,resetCode,resetPin);setResetRequestId(null);setResetCode('');setResetPin('');setResetPinConfirm('');setPinUnlocked(true);toast.success('PIN reset confirmed. Security notification sent.');}
  catch(e:any){toast.error(e?.message??'Could not confirm PIN reset')}finally{setSecurityBusy(false);}
 };

 if(loading)return <div className="min-h-screen flex items-center justify-center"><Activity className="animate-pulse"/></div>;

 if(!canOpen)return <div className="min-h-screen"><TopBar title="Staff Workspace" showBack/><div className="max-w-md mx-auto p-6 mt-10 rounded-2xl border border-border bg-card text-center"><KeyRound className="mx-auto w-8 h-8 text-primary"/><h1 className="font-bold mt-3">Staff Workspace</h1><p className="text-sm text-muted-foreground mt-2">Enter your staff PIN to continue.</p><form className="mt-5 space-y-3" onSubmit={(e)=>{e.preventDefault();void verifyPin()}}><input aria-label="Staff workspace PIN" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} type="password" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="PIN" className="w-full h-12 rounded-xl border border-border bg-background px-4 text-center text-xl tracking-[0.5em]" disabled={pinBusy}/><button type="submit" disabled={pinBusy || pin.length<4} className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50">{pinBusy?'Checking…':'Unlock Staff Workspace'}</button></form><div className="mt-5 pt-5 border-t border-border text-left"><p className="text-xs font-bold">First-time PIN setup</p><p className="text-[11px] text-muted-foreground mt-1">Only the designated staff account can initialize its PIN. The action is emailed to the system security mailbox.</p><div className="grid grid-cols-2 gap-2 mt-3"><input aria-label="Initial PIN" inputMode="numeric" type="password" maxLength={6} value={initialPin} onChange={e=>setInitialPin(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="New PIN" className="h-10 rounded-xl border border-border bg-background px-3"/><input aria-label="Confirm initial PIN" inputMode="numeric" type="password" maxLength={6} value={initialPinConfirm} onChange={e=>setInitialPinConfirm(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="Confirm" className="h-10 rounded-xl border border-border bg-background px-3"/></div><button type="button" onClick={()=>void initializePin()} disabled={securityBusy||initialPin.length<4||initialPin!==initialPinConfirm} className="w-full h-10 mt-2 rounded-xl border border-primary/30 text-primary font-bold disabled:opacity-50">{securityBusy?'Saving…':'Set initial PIN'}</button></div><p className="text-[11px] text-muted-foreground mt-4">PIN verification is server-side, rate-limited and audited.</p></div></div>;

 return <div className="min-h-screen bg-background pb-20"><TopBar title="Staff Workspace" showBack/><div className="max-w-4xl mx-auto p-4 space-y-5">
  <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5"><div className="flex gap-4 items-center"><div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><ShieldCheck className="w-7 h-7"/></div><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Testagram staff</p><h1 className="font-black text-2xl">{governance.is_owner ? 'System Owner' : (role?.label??'Staff Workspace')}</h1><p className="text-sm text-muted-foreground">{governance.is_owner ? 'Full Testagram platform access · Owner' : governance.is_admin ? ((role?.description??'Assigned governance role')+' · '+governance.status) : 'PIN-authorized staff access'}</p></div></div></section>

  <section className="rounded-2xl border border-primary/20 bg-card p-4"><div className="flex items-start gap-3"><div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><MailCheck className="w-5 h-5"/></div><div><h2 className="font-bold">Privileged-access monitoring</h2><p className="text-xs text-muted-foreground mt-1">PIN changes, resets and governance actions are audited. Security notifications are sent to the system security mailbox.</p></div></div></section>

  {!governance.is_owner && <section className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary"/><h2 className="font-bold">PIN security</h2></div><p className="text-xs text-muted-foreground mt-1">Change your PIN with the current PIN, or start a reset that requires a confirmation code from the system security mailbox.</p><div className="grid md:grid-cols-3 gap-2 mt-4"><input aria-label="Current PIN" type="password" inputMode="numeric" maxLength={6} value={currentPin} onChange={e=>setCurrentPin(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="Current PIN" className="h-10 rounded-xl border border-border bg-background px-3"/><input aria-label="New PIN" type="password" inputMode="numeric" maxLength={6} value={newPin} onChange={e=>setNewPin(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="New PIN" className="h-10 rounded-xl border border-border bg-background px-3"/><input aria-label="Confirm new PIN" type="password" inputMode="numeric" maxLength={6} value={newPinConfirm} onChange={e=>setNewPinConfirm(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="Confirm new PIN" className="h-10 rounded-xl border border-border bg-background px-3"/></div><div className="flex flex-wrap gap-2 mt-3"><button type="button" onClick={()=>void changePin()} disabled={securityBusy||currentPin.length<4||newPin.length<4||newPin!==newPinConfirm} className="h-10 px-4 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50">{securityBusy?'Working…':'Change PIN'}</button><button type="button" onClick={()=>void requestReset()} disabled={securityBusy} className="h-10 px-4 rounded-xl border border-border font-bold disabled:opacity-50"><RefreshCw className="w-4 h-4 inline mr-2"/>Request reset code</button></div>{resetRequestId&&<div className="mt-4 p-4 rounded-xl bg-muted/40 border border-border"><p className="text-sm font-bold">Reset confirmation</p><p className="text-xs text-muted-foreground mt-1">Enter the 6-digit code delivered to the system security mailbox. It expires in 10 minutes.</p><div className="grid md:grid-cols-3 gap-2 mt-3"><input aria-label="Reset confirmation code" inputMode="numeric" maxLength={6} value={resetCode} onChange={e=>setResetCode(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="6-digit code" className="h-10 rounded-xl border border-border bg-background px-3"/><input aria-label="Reset PIN" type="password" inputMode="numeric" maxLength={6} value={resetPin} onChange={e=>setResetPin(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="New PIN" className="h-10 rounded-xl border border-border bg-background px-3"/><input aria-label="Confirm reset PIN" type="password" inputMode="numeric" maxLength={6} value={resetPinConfirm} onChange={e=>setResetPinConfirm(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="Confirm new PIN" className="h-10 rounded-xl border border-border bg-background px-3"/></div><button type="button" onClick={()=>void confirmReset()} disabled={securityBusy||resetCode.length!==6||resetPin.length<4||resetPin!==resetPinConfirm} className="w-full h-10 mt-3 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50">{securityBusy?'Confirming…':'Confirm PIN reset'}</button></div>}</section>}

  <section className="grid sm:grid-cols-3 gap-3">{[['Role status',governance.is_owner?'Active owner':governance.is_admin?'Active staff':'PIN authorized',CheckCircle2],['Authority',governance.is_owner?'Unrestricted':governance.is_admin?'Assigned permissions':'Workspace access',Crown],['Access model',governance.is_owner?'System owner':governance.is_admin?'Staff assignment':'Staff PIN',ShieldCheck]].map(([a,b,I]:any)=><div key={a} className="rounded-2xl border border-border bg-card p-4"><I className="w-5 h-5 text-primary"/><p className="text-xs text-muted-foreground mt-3">{a}</p><p className="font-black mt-1">{b}</p></div>)}</section>
  <section className="rounded-2xl border border-primary/20 bg-card overflow-hidden"><div className="p-4 border-b border-border"><h2 className="font-bold">Staff command center</h2><p className="text-xs text-muted-foreground mt-1">{governance.is_owner?'You are the Testagram system owner.':governance.is_admin?'Your staff assignment controls the available capabilities.':'PIN access is enabled for this authorized staff account.'}</p></div><div className="grid md:grid-cols-2">{caps.map(({key,label,icon:Icon,description,path})=><button key={key} type="button" onClick={()=>navigate(path)} aria-label={'Open '+label} className="group w-full p-4 border-b border-border md:[&:nth-child(odd)]:border-r text-left cursor-pointer transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset active:bg-muted"><div className="flex gap-3"><div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 transition-transform group-hover:scale-105"><Icon className="w-4 h-4"/></div><div className="flex-1 min-w-0"><div className="flex items-start gap-2"><p className="font-bold text-sm flex-1">{label}</p><ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true"/></div><p className="text-xs text-muted-foreground mt-1">{description}</p><span className="inline-flex mt-2 text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary font-bold">{governance.is_owner?'OWNER AUTHORITY':governance.is_admin?'STAFF PERMISSION':'PIN ACCESS'}</span></div></div></button>)}</div></section>
  <section className="grid sm:grid-cols-2 gap-3"><button onClick={()=>navigate('/team-chat')} className="rounded-2xl border border-border bg-card p-4 text-left hover:bg-muted"><MessageSquare className="w-5 h-5"/><p className="font-bold mt-2">Staff Team Chat</p><p className="text-xs text-muted-foreground mt-1">Coordinate with the Testagram team.</p><ArrowRight className="w-4 h-4 mt-3"/></button><button onClick={()=>navigate('/jobs')} className="rounded-2xl border border-border bg-card p-4 text-left hover:bg-muted"><ClipboardList className="w-5 h-5"/><p className="font-bold mt-2">Jobs & applications</p><p className="text-xs text-muted-foreground mt-1">Review your invitation and application history.</p><ArrowRight className="w-4 h-4 mt-3"/></button></section>
 </div></div>;
}
