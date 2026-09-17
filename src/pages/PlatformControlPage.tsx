import { useEffect, useMemo, useState } from 'react';
import { Crown, Loader2, Search, ShieldCheck, UserPlus, UserRoundCog } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

const ROLES = [
  ['platform_admin', 'Platform Admin'],
  ['operations_manager', 'Operations Manager'],
  ['finance_manager', 'Finance Manager'],
  ['ads_manager', 'Ads Manager'],
  ['moderation_manager', 'Moderation Manager'],
  ['verification_manager', 'Verification Manager'],
  ['support_manager', 'Support Manager'],
  ['analytics_manager', 'Analytics Manager'],
] as const;

type Profile = { id: string; username: string | null; display_name: string | null; avatar_url: string | null };
type Assignment = { id: string; user_id: string; role_key: string; active: boolean; appointed_at: string; profile?: Profile };

export default function PlatformControlPage() {
  const { user } = useAuth();
  const [owner, setOwner] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number][0]>('platform_admin');
  const [activate, setActivate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: ownerResult } = await supabase.rpc('is_platform_owner');
    const isOwner = ownerResult === true;
    setOwner(isOwner);
    if (!isOwner) { setLoading(false); return; }

    const [{ data: people }, { data: roles }] = await Promise.all([
      supabase.from('profiles').select('id, username, display_name, avatar_url').order('created_at', { ascending: true }).limit(200),
      supabase.from('platform_role_assignments').select('id, user_id, role_key, active, appointed_at').order('appointed_at', { ascending: false }),
    ]);
    const peopleList = (people as Profile[]) ?? [];
    setProfiles(peopleList);
    setAssignments(((roles as Assignment[]) ?? []).map(a => ({ ...a, profile: peopleList.find(p => p.id === a.user_id) })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, [user?.id]);

  const filteredProfiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles.slice(0, 20);
    return profiles.filter(p => `${p.username ?? ''} ${p.display_name ?? ''}`.toLowerCase().includes(q)).slice(0, 20);
  }, [profiles, query]);

  const appoint = async (profile: Profile) => {
    if (!owner || !user || working) return;
    setWorking(profile.id);
    const { error } = await supabase.rpc('platform_appoint_role', {
      p_user_id: profile.id,
      p_role_key: role,
      p_activate: activate,
    });
    setWorking(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${profile.display_name || profile.username || 'User'} appointed as ${ROLES.find(r => r[0] === role)?.[1]}` + (activate ? ' and activated.' : '. Hidden until activated.'));
    await load();
  };

  const toggleRole = async (assignment: Assignment) => {
    setWorking(assignment.id);
    const { error } = await supabase.rpc('platform_set_role_active', { p_assignment_id: assignment.id, p_active: !assignment.active });
    setWorking(null);
    if (error) { toast.error(error.message); return; }
    toast.success(assignment.active ? 'Role deactivated; profile admin features are hidden.' : 'Role activated; assigned profile admin features are now visible.');
    await load();
  };

  const revokeRole = async (assignment: Assignment) => {
    setWorking(assignment.id);
    const { error } = await supabase.rpc('platform_revoke_role', { p_assignment_id: assignment.id });
    setWorking(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Role revoked and its admin features hidden.');
    await load();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin" /></div>;
  if (!owner) return <div className="min-h-screen flex items-center justify-center px-6 text-center"><div><ShieldCheck className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><h1 className="font-bold text-lg">Platform Control</h1><p className="text-sm text-muted-foreground mt-1">Only the platform owner can appoint or activate platform roles.</p></div></div>;

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <main className="max-w-3xl mx-auto space-y-6 pb-12">
        <header className="rounded-3xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><Crown className="w-5 h-5" /></div>
            <div><h1 className="text-xl font-black">Platform Control</h1><p className="text-sm text-muted-foreground mt-1">Owner-only governance. Appointment and activation are separate controls.</p></div>
          </div>
        </header>

        <section className="rounded-3xl border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2"><UserPlus className="w-4 h-4" /><h2 className="font-bold">Appoint a manager or admin</h2></div>
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search username or display name" className="w-full h-11 rounded-2xl border border-border bg-background pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" /></div>
            <select value={role} onChange={e => setRole(e.target.value as typeof role)} className="h-11 rounded-2xl border border-border bg-background px-3 text-sm font-semibold">{ROLES.map(([key,title]) => <option key={key} value={key}>{title}</option>)}</select>
          </div>
          <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={activate} onChange={e => setActivate(e.target.checked)} /><span><b>Activate immediately</b><span className="block text-xs text-muted-foreground">Off = appointed but hidden from the profile until you activate it.</span></span></label>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {filteredProfiles.map(profile => <div key={profile.id} className="flex items-center gap-3 rounded-2xl border border-border p-3"><img src={profile.avatar_url || '/placeholder.svg'} alt="" className="w-9 h-9 rounded-full object-cover bg-muted" /><div className="min-w-0 flex-1"><p className="font-semibold text-sm truncate">{profile.display_name || profile.username || 'Unnamed user'}</p><p className="text-xs text-muted-foreground truncate">@{profile.username || 'unknown'}</p></div><button disabled={working === profile.id} onClick={() => void appoint(profile)} className="px-3 py-2 rounded-xl bg-foreground text-background text-xs font-bold disabled:opacity-50">{working === profile.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Appoint'}</button></div>)}
            {filteredProfiles.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No matching profiles.</p>}
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2"><UserRoundCog className="w-4 h-4" /><h2 className="font-bold">Current appointments</h2></div>
          <div className="space-y-2">
            {assignments.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No managers or admins appointed yet.</p>}
            {assignments.map(a => <div key={a.id} className="flex items-center gap-3 rounded-2xl border border-border p-3"><div className="min-w-0 flex-1"><p className="font-semibold text-sm">{a.profile?.display_name || a.profile?.username || a.user_id}</p><p className="text-xs text-muted-foreground">{ROLES.find(r => r[0] === a.role_key)?.[1] ?? a.role_key} · {a.active ? 'Active' : 'Appointed / hidden'}</p></div><button disabled={working === a.id} onClick={() => void toggleRole(a)} className="px-3 py-2 rounded-xl border border-border text-xs font-bold">{a.active ? 'Deactivate' : 'Activate'}</button><button disabled={working === a.id} onClick={() => void revokeRole(a)} className="px-3 py-2 rounded-xl bg-destructive text-destructive-foreground text-xs font-bold">Revoke</button></div>)}
          </div>
        </section>
      </main>
    </div>
  );
}
