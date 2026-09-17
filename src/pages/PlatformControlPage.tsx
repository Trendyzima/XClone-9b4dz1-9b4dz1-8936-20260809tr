import { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, ChevronRight, Crown, Eye, History, Loader2, Search, ShieldCheck, UserPlus, Users, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

type Role = { key: string; title: string; description: string | null; can_appoint: boolean; feature_count?: number };
type Profile = { id: string; username: string | null; display_name: string | null; avatar_url: string | null };
type Assignment = { id: string; user_id: string; role_key: string; active: boolean; appointed_at: string; activated_at: string | null; revoked_at: string | null; profile?: Profile; role?: Role };
type Audit = { id: string; user_id: string; event_type: string; resource_type: string; resource_id: string | null; metadata: Record<string, unknown>; created_at: string };

const formatDate = (value: string | null) => value ? new Date(value).toLocaleString() : '—';
const roleLabel = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export default function PlatformControlPage() {
  const { user } = useAuth();
  const [owner, setOwner] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [activate, setActivate] = useState(true);
  const [tab, setTab] = useState<'governance' | 'audit'>('governance');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: ownerResult } = await supabase.rpc('is_platform_owner');
    const isOwner = ownerResult === true;
    setOwner(isOwner);
    if (!isOwner) { setLoading(false); return; }

    const [{ data: roleRows }, { data: assignmentRows }, { data: auditRows }] = await Promise.all([
      supabase.from('platform_roles').select('key,title,description,can_appoint,platform_role_features(feature_key)').order('title'),
      supabase.from('platform_role_assignments').select('id,user_id,role_key,active,appointed_at,activated_at,revoked_at').order('appointed_at', { ascending: false }),
      supabase.rpc('platform_control_audit', { limit_count: 100 }),
    ]);

    const roleList = ((roleRows as any[]) ?? []).map(r => ({ ...r, feature_count: Array.isArray(r.platform_role_features) ? r.platform_role_features.length : 0 }));
    setRoles(roleList);
    if (!role && roleList[0]) setRole(roleList[0].key);

    const ids = Array.from(new Set(((assignmentRows as Assignment[]) ?? []).map(a => a.user_id)));
    let people: Profile[] = [];
    if (ids.length) {
      const { data } = await supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', ids);
      people = (data as Profile[]) ?? [];
    }
    setProfiles(people);
    setAssignments(((assignmentRows as Assignment[]) ?? []).map(a => ({ ...a, profile: people.find(p => p.id === a.user_id), role: roleList.find(r => r.key === a.role_key) })));
    setAudit((auditRows as Audit[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [user?.id]);

  const searchProfiles = async () => {
    const q = query.trim();
    if (!q) { setProfiles([]); return; }
    const { data, error } = await supabase.from('profiles').select('id,username,display_name,avatar_url').or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).order('display_name').limit(25);
    if (error) toast.error(error.message); else setProfiles((data as Profile[]) ?? []);
  };

  const selectedRole = roles.find(r => r.key === role);
  const activeAssignments = assignments.filter(a => a.active && !a.revoked_at);
  const inactiveAssignments = assignments.filter(a => !a.active || a.revoked_at);

  const appoint = async (profile: Profile) => {
    if (!owner || !role || working) return;
    setWorking(profile.id);
    const { error } = await supabase.rpc('platform_appoint_role', { p_user_id: profile.id, p_role_key: role, p_activate: activate });
    setWorking(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${profile.display_name || profile.username || 'User'} appointed as ${selectedRole?.title || role}.`);
    setQuery('');
    setProfiles([]);
    await load();
  };

  const toggleRole = async (assignment: Assignment) => {
    setWorking(assignment.id);
    const { error } = await supabase.rpc('platform_set_role_active', { p_assignment_id: assignment.id, p_active: !assignment.active });
    setWorking(null);
    if (error) { toast.error(error.message); return; }
    toast.success(assignment.active ? 'Role deactivated.' : 'Role activated.');
    await load();
  };

  const revokeRole = async (assignment: Assignment) => {
    if (!confirm('Revoke this role? The assigned platform features will be removed unless another active role grants them.')) return;
    setWorking(assignment.id);
    const { error } = await supabase.rpc('platform_revoke_role', { p_assignment_id: assignment.id });
    setWorking(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Role revoked.');
    await load();
  };

  const roleCounts = useMemo(() => roles.map(r => ({ ...r, assigned: assignments.filter(a => a.role_key === r.key && !a.revoked_at).length, active: assignments.filter(a => a.role_key === r.key && a.active && !a.revoked_at).length })), [roles, assignments]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin" /></div>;
  if (!owner) return <div className="min-h-screen flex items-center justify-center px-6 text-center"><div><ShieldCheck className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><h1 className="font-bold text-lg">Platform Control</h1><p className="text-sm text-muted-foreground mt-1">Owner-only governance.</p></div></div>;

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <main className="max-w-6xl mx-auto space-y-6 pb-12">
        <header className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3"><div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><Crown className="w-6 h-6" /></div><div><h1 className="text-2xl font-black">Platform Owner Control Center</h1><p className="text-sm text-muted-foreground mt-1">Central governance for Testagram administration, specialist roles and audited appointments.</p></div></div>
            <div className="flex items-center gap-2 rounded-2xl border border-border px-4 py-3 text-sm"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Owner controls active</div>
          </div>
        </header>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[[Users, 'Active role holders', activeAssignments.length], [ShieldCheck, 'Role types', roles.length], [Activity, 'Active assignments', activeAssignments.length], [History, 'Audit events loaded', audit.length]].map(([Icon, label, value]: any) => <div key={label} className="rounded-2xl border border-border bg-card p-4"><Icon className="w-4 h-4 text-muted-foreground mb-3" /><p className="text-2xl font-black">{value}</p><p className="text-xs text-muted-foreground mt-1">{label}</p></div>)}
        </section>

        <div className="flex gap-2 border-b border-border"><button onClick={() => setTab('governance')} className={`px-4 py-3 text-sm font-bold ${tab === 'governance' ? 'border-b-2 border-foreground' : 'text-muted-foreground'}`}>Governance</button><button onClick={() => setTab('audit')} className={`px-4 py-3 text-sm font-bold ${tab === 'audit' ? 'border-b-2 border-foreground' : 'text-muted-foreground'}`}>Audit trail</button></div>

        {tab === 'governance' ? <>
          <section className="rounded-3xl border border-border bg-card p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2"><UserPlus className="w-4 h-4" /><h2 className="font-bold">Appoint a platform role</h2></div>
            <div className="grid gap-3 lg:grid-cols-[1fr_280px_auto]">
              <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void searchProfiles(); }} placeholder="Search username or display name, then press Enter" className="w-full h-11 rounded-2xl border border-border bg-background pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" /></div>
              <select value={role} onChange={e => setRole(e.target.value)} className="h-11 rounded-2xl border border-border bg-background px-3 text-sm font-semibold">{roles.map(r => <option key={r.key} value={r.key}>{r.title} · {r.feature_count ?? 0} features</option>)}</select>
              <label className="h-11 flex items-center gap-2 rounded-2xl border border-border px-3 text-sm"><input type="checkbox" checked={activate} onChange={e => setActivate(e.target.checked)} /> Activate immediately</label>
            </div>
            {selectedRole && <div className="rounded-2xl bg-muted/40 p-4 text-sm"><b>{selectedRole.title}</b><p className="text-muted-foreground mt-1">{selectedRole.description || 'No description.'}</p></div>}
            {profiles.length > 0 && <div className="space-y-2">{profiles.map(profile => <div key={profile.id} className="flex items-center gap-3 rounded-2xl border border-border p-3"><img src={profile.avatar_url || '/placeholder.svg'} alt="" className="w-9 h-9 rounded-full object-cover bg-muted" /><div className="min-w-0 flex-1"><p className="font-semibold text-sm truncate">{profile.display_name || profile.username || 'Unnamed user'}</p><p className="text-xs text-muted-foreground truncate">@{profile.username || 'unknown'}</p></div><button disabled={working === profile.id} onClick={() => void appoint(profile)} className="px-3 py-2 rounded-xl bg-foreground text-background text-xs font-bold disabled:opacity-50">{working === profile.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Appoint'}</button></div>)}</div>}
          </section>

          <section className="rounded-3xl border border-border bg-card p-5 shadow-sm"><div className="flex items-center gap-2 mb-4"><ShieldCheck className="w-4 h-4" /><h2 className="font-bold">Role catalog</h2></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{roleCounts.map(r => <div key={r.key} className="rounded-2xl border border-border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-sm">{r.title}</p><p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.description}</p></div><ChevronRight className="w-4 h-4 text-muted-foreground" /></div><div className="flex gap-3 mt-4 text-xs"><span>{r.feature_count} features</span><span>{r.active} active</span></div></div>)}</div></section>

          <section className="rounded-3xl border border-border bg-card p-5 shadow-sm space-y-3"><div className="flex items-center gap-2"><Users className="w-4 h-4" /><h2 className="font-bold">Current appointments</h2></div>{assignments.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No specialist appointments yet.</p>}{assignments.map(a => <div key={a.id} className="flex flex-col gap-3 rounded-2xl border border-border p-4 md:flex-row md:items-center"><div className="min-w-0 flex-1"><p className="font-semibold text-sm">{a.profile?.display_name || a.profile?.username || a.user_id}</p><p className="text-xs text-muted-foreground">{a.role?.title || roleLabel(a.role_key)} · {a.active && !a.revoked_at ? 'Active' : a.revoked_at ? 'Revoked' : 'Inactive'} · appointed {formatDate(a.appointed_at)}</p></div><div className="flex gap-2"><button disabled={!!working} onClick={() => void toggleRole(a)} className="px-3 py-2 rounded-xl border border-border text-xs font-bold">{a.active && !a.revoked_at ? 'Deactivate' : 'Activate'}</button>{!a.revoked_at && <button disabled={!!working} onClick={() => void revokeRole(a)} className="px-3 py-2 rounded-xl bg-destructive text-destructive-foreground text-xs font-bold">Revoke</button>}</div></div>)}</section>
        </> : <section className="rounded-3xl border border-border bg-card p-5 shadow-sm space-y-3"><div className="flex items-center gap-2 mb-4"><Eye className="w-4 h-4" /><h2 className="font-bold">Owner audit trail</h2></div>{audit.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No role governance events recorded yet.</p>}{audit.map(e => <div key={e.id} className="rounded-2xl border border-border p-4"><div className="flex items-center gap-2"><span className="text-xs font-bold">{e.event_type}</span><span className="text-xs text-muted-foreground ml-auto">{formatDate(e.created_at)}</span></div><p className="text-xs text-muted-foreground mt-2">Resource: {e.resource_type}{e.resource_id ? ` · ${e.resource_id}` : ''}</p><pre className="text-[11px] mt-2 whitespace-pre-wrap break-words text-muted-foreground">{JSON.stringify(e.metadata, null, 2)}</pre></div>)}</section>}
      </main>
    </div>
  );
}
