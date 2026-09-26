import { useEffect, useState } from 'react';
import { Shield, Crown, Search, UserPlus, Ban, CheckCircle2, RotateCcw, History, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { TopBar } from '@/components/layout/TopBar';
import { useGovernance, listAdministrators, searchGovernanceUsers, listGovernanceAudit, listGovernancePermissions, appointAdministrator, updateAdministrator, GOVERNANCE_ROLES } from '@/lib/governance';

export default function AdminGovernancePage() {
  const { governance, loading: governanceLoading } = useGovernance();
  const [admins, setAdmins] = useState<Awaited<ReturnType<typeof listAdministrators>>>([]);
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchGovernanceUsers>>>([]);
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof listGovernanceAudit>>>([]);
  const [permissions, setPermissions] = useState<Awaited<ReturnType<typeof listGovernancePermissions>>>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('moderator');
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  const load = async () => {
    setLoadingData(true);
    try { const [a, h] = await Promise.all([listAdministrators(), listGovernanceAudit(), governance.is_owner ? listGovernancePermissions() : Promise.resolve([])]); setAdmins(a); setAudit(h); setPermissions(p); }
    catch (error: any) { toast.error(error?.message ?? 'Could not load governance data'); }
    finally { setLoadingData(false); }
  };
  useEffect(() => { if (governance.is_owner || governance.is_admin) void load(); }, [governance.is_owner, governance.is_admin]);

  const search = async (value: string) => {
    setQuery(value);
    if (!governance.is_owner || value.trim().length < 2) { setResults([]); return; }
    try { setResults(await searchGovernanceUsers(value)); } catch { setResults([]); }
  };
  const appoint = async (userId: string, username: string) => {
    setBusy(userId);
    try { await appointAdministrator(userId, role, selectedPermissions); toast.success('@' + username + ' appointed'); setResults([]); setQuery(''); setSelectedPermissions([]); await load(); }
    catch (error: any) { toast.error(error?.message ?? 'Appointment failed'); }
    finally { setBusy(null); }
  };
  const change = async (userId: string, currentRole: string, status: 'active' | 'suspended' | 'revoked') => {
    setBusy(userId);
    try { await updateAdministrator(userId, currentRole, status, 'Owner changed administrator status to ' + status); toast.success(status === 'revoked' ? 'Administrator revoked' : 'Administrator ' + status); await load(); }
    catch (error: any) { toast.error(error?.message ?? 'Governance update failed'); }
    finally { setBusy(null); }
  };

  if (governanceLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  if (!governance.is_admin && !governance.is_owner) return <div className="min-h-screen p-6"><TopBar title="Admin & Governance" showBack /><div className="max-w-xl mx-auto mt-12 rounded-2xl border border-border bg-card p-6 text-center"><Shield className="w-8 h-8 mx-auto text-muted-foreground" /><h1 className="font-bold text-lg mt-3">Governance is locked</h1><p className="text-sm text-muted-foreground mt-2">The Testagram system owner must appoint this account before administrative access is activated.</p></div></div>;

  return <div className="min-h-screen bg-background pb-20">
    <TopBar title="Admin & Governance" showBack />
    <div className="max-w-3xl mx-auto p-4 space-y-5">
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5"><div className="flex items-center gap-3"><div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">{governance.is_owner ? <Crown /> : <Shield />}</div><div><h1 className="font-black text-xl">{governance.is_owner ? 'Testagram System Owner' : 'Administrator Workspace'}</h1><p className="text-sm text-muted-foreground">{governance.is_owner ? 'Full governance authority' : (governance.role ?? 'Administrator') + ' · ' + (governance.status ?? 'active')}</p></div></div></div>
      {governance.is_owner && <section className="rounded-2xl border border-border bg-card p-5 space-y-4"><div><h2 className="font-bold flex items-center gap-2"><UserPlus className="w-4 h-4" /> Appoint an administrator</h2><p className="text-xs text-muted-foreground mt-1">Search a Testagram profile, choose a least-privilege role, then appoint it.</p></div><div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={query} onChange={e => void search(e.target.value)} placeholder="Search username or display name" className="w-full h-10 rounded-xl border border-border bg-background pl-9 pr-3 text-sm" /></div><select value={role} onChange={e => setRole(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm">{GOVERNANCE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select><div className="rounded-xl border border-border bg-background p-3"><p className="text-xs font-bold mb-2">Job permissions · optional overrides</p><div className="grid sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">{permissions.map(p => <label key={p.key} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={selectedPermissions.includes(p.key)} onChange={e => setSelectedPermissions(prev => e.target.checked ? [...prev,p.key] : prev.filter(k => k !== p.key))} className="mt-0.5" /><span><b>{p.key}</b><span className="block text-muted-foreground">{p.description}</span></span></label>)}</div></div></div>{results.length > 0 && <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">{results.map(user => <button key={user.user_id} onClick={() => void appoint(user.user_id, user.username)} disabled={!!busy} className="w-full flex items-center gap-3 p-3 bg-background hover:bg-muted text-left">{user.avatar_url ? <img src={user.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" /> : <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center font-bold">{user.username[0]?.toUpperCase()}</div>}<span className="flex-1"><b className="text-sm">@{user.username}</b><span className="block text-xs text-muted-foreground">{user.display_name ?? ''}</span></span>{busy === user.user_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4 text-primary" />}</button>)}</div>}</section>}
      <section className="rounded-2xl border border-border bg-card overflow-hidden"><div className="p-4 border-b border-border flex items-center justify-between"><h2 className="font-bold">Administrators</h2>{loadingData && <Loader2 className="w-4 h-4 animate-spin" />}</div>{admins.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No administrator appointments yet.</p> : <div className="divide-y divide-border">{admins.map(a => <div key={a.user_id} className="p-4 flex items-center gap-3"><div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center font-bold">{a.username[0]?.toUpperCase()}</div><div className="flex-1 min-w-0"><p className="font-bold text-sm">@{a.username}</p><p className="text-xs text-muted-foreground">{a.role_name} · {a.status}</p></div>{governance.is_owner && <div className="flex gap-2">{a.status === 'active' ? <button onClick={() => void change(a.user_id, a.role_name, 'suspended')} disabled={!!busy} className="p-2 rounded-lg border border-border hover:bg-muted" title="Suspend"><Ban className="w-4 h-4" /></button> : <button onClick={() => void change(a.user_id, a.role_name, 'active')} disabled={!!busy} className="p-2 rounded-lg border border-border hover:bg-muted" title="Activate"><CheckCircle2 className="w-4 h-4" /></button>}{a.status !== 'revoked' && <button onClick={() => void change(a.user_id, a.role_name, 'revoked')} disabled={!!busy} className="p-2 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/5" title="Revoke"><RotateCcw className="w-4 h-4" /></button>}</div>}</div>)}</div>}</section>
      <section className="rounded-2xl border border-border bg-card overflow-hidden"><div className="p-4 border-b border-border flex items-center gap-2"><History className="w-4 h-4" /><h2 className="font-bold">Governance Audit</h2></div><div className="divide-y divide-border">{audit.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No governance events yet.</p> : audit.map(event => <div key={event.id} className="p-4"><p className="text-sm font-semibold">{event.action}</p><p className="text-xs text-muted-foreground mt-1">{event.actor_username ? '@' + event.actor_username : 'System'} → {event.target_username ? '@' + event.target_username : '—'} · {new Date(event.created_at).toLocaleString()}</p><p className="text-xs text-muted-foreground mt-1">{event.reason ?? ''}</p></div>)}</div></section>
    </div>
  </div>;
}