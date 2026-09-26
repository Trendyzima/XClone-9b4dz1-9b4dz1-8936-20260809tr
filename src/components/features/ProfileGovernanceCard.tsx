import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, LockKeyhole, ShieldCheck, UserPlus, Settings2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { appointAdministrator, getGovernanceForUser, GOVERNANCE_ROLES, useGovernance } from '@/lib/governance';

export function ProfileGovernanceCard({ profileId, username, isOwnProfile }: { profileId: string; username: string; isOwnProfile: boolean }) {
  const navigate = useNavigate();
  const { governance: viewer, loading: viewerLoading } = useGovernance();
  const [target, setTarget] = useState<{ is_owner?: boolean; is_admin?: boolean; role?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [appointing, setAppointing] = useState(false);
  const [role, setRole] = useState('moderator');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try { const data = await getGovernanceForUser(profileId); if (!cancelled) setTarget(data); }
      catch { if (!cancelled) setTarget(null); }
      finally { if (!cancelled) setLoading(false); }
    };
    if (viewer.is_owner || isOwnProfile) void load(); else setLoading(false);
    return () => { cancelled = true; };
  }, [profileId, viewer.is_owner, isOwnProfile]);

  const unlocked = !!target?.is_owner || !!target?.is_admin;
  const canManage = viewer.is_owner && !target?.is_owner && !isOwnProfile;
  const appoint = async () => {
    setAppointing(true);
    try { await appointAdministrator(profileId, role); toast.success('Administrator appointment activated'); setTarget({ is_admin: true, is_owner: false, role }); }
    catch (error: any) { toast.error(error?.message ?? 'Administrator appointment failed'); }
    finally { setAppointing(false); }
  };

  if (viewerLoading || loading) return <div className="mx-4 mt-3 h-20 rounded-2xl border border-border bg-card animate-pulse" aria-hidden="true" />;

  const roleLabel = GOVERNANCE_ROLES.find(r => r.value === target?.role)?.label ?? target?.role ?? 'Administrator';
  return (
    <section className="mx-4 mt-3 rounded-2xl border border-border bg-card overflow-hidden" aria-label="Admin & Governance">
      <div className="flex items-center gap-3 p-4">
        <div className={'w-10 h-10 rounded-xl flex items-center justify-center ' + (unlocked ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
          {unlocked ? <ShieldCheck className="w-5 h-5" /> : <LockKeyhole className="w-5 h-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-sm flex items-center gap-2">Admin & Governance {target?.is_owner && <Crown className="w-4 h-4 text-amber-500" aria-label="System owner" />}</p>
          <p className="text-xs text-muted-foreground">{target?.is_owner ? 'System Owner · Full platform governance' : target?.is_admin ? roleLabel + ' · Active' : 'Locked · Activated only by the Testagram system owner'}</p>
        </div>
        {unlocked && !canManage && <button onClick={() => navigate('/admin/governance')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90"><Settings2 className="w-3.5 h-3.5" /> Manage</button>}
      </div>
      {canManage && <div className="border-t border-border bg-primary/5 p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground">Owner Controls · appoint @{username}</p>
        <div className="flex gap-2">
          <select value={role} onChange={e => setRole(e.target.value)} className="min-w-0 flex-1 h-10 rounded-xl border border-border bg-background px-3 text-sm">{GOVERNANCE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
          <button onClick={() => void appoint()} disabled={appointing} className="px-4 h-10 rounded-xl bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50 inline-flex items-center gap-2">{appointing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} Appoint</button>
        </div>
        <p className="text-[11px] text-muted-foreground">Privileged appointments are enforced server-side.</p>
      </div>}
    </section>
  );
}