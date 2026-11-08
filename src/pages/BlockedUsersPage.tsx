import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { toast } from 'sonner';
import { Shield, Loader2, UserX, User, VolumeX } from 'lucide-react';

// esbuild guard: module-level helper — no inline string ops in JSX
function formatHandle(username: string): string {
  return username ? `@${username}` : '@unknown';
}

// esbuild guard: module-level tab ids
const TAB_BLOCKED = 'blocked';
const TAB_MUTED = 'muted';

export default function BlockedUsersPage() {
  useSEO({ noindex: true, title: 'Blocked & Muted Users', url: '/blocked' });
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(TAB_BLOCKED);

  // ── Blocked — parallel arrays ──────────────────────────────────────────────
  const [blockIds, setBlockIds] = useState([]);
  const [blockedUsernames, setBlockedUsernames] = useState([]);
  const [blockedAvatars, setBlockedAvatars] = useState([]);
  const [blockLoading, setBlockLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState('');

  // ── Muted — parallel arrays ────────────────────────────────────────────────
  const [muteIds, setMuteIds] = useState([]);
  const [mutedUsernames, setMutedUsernames] = useState([]);
  const [mutedAvatars, setMutedAvatars] = useState([]);
  const [muteLoading, setMuteLoading] = useState(true);
  const [unmutingId, setUnmutingId] = useState('');

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    backendCapabilities.call<{ items?: Array<{ id: string; username?: string; avatar_url?: string }> }>('testagram.blocks.list')
      .then(({ items = [] }) => { setBlockIds(items.map(x=>x.id) as any); setBlockedUsernames(items.map(x=>x.username??'unknown') as any); setBlockedAvatars(items.map(x=>x.avatar_url??'') as any); })
      .catch(e=>toast.error(e instanceof Error?e.message:'Could not load blocked users.'))
      .finally(()=>setBlockLoading(false));
    backendCapabilities.call<{ items?: Array<{ id: string; username?: string; avatar_url?: string }> }>('testagram.mutes.list')
      .then(({ items = [] }) => { setMuteIds(items.map(x=>x.id) as any); setMutedUsernames(items.map(x=>x.username??'unknown') as any); setMutedAvatars(items.map(x=>x.avatar_url??'') as any); })
      .catch(e=>toast.error(e instanceof Error?e.message:'Could not load muted users.'))
      .finally(()=>setMuteLoading(false));
  }, [user?.id, navigate]);

  const handleUnblock = async (blockId: string, username: string, idx: number) => {
    setUnblockingId(blockId);
    try { await backendCapabilities.call('testagram.blocks.remove', { block_id: blockId }); }
    catch (error) { setUnblockingId(''); toast.error(error instanceof Error?error.message:'Failed to unblock'); return; }
    setUnblockingId('');
    const ids = [...(blockIds as string[])];
    const unames = [...(blockedUsernames as string[])];
    const avs = [...(blockedAvatars as string[])];
    ids.splice(idx, 1);
    unames.splice(idx, 1);
    avs.splice(idx, 1);
    setBlockIds(ids as any);
    setBlockedUsernames(unames as any);
    setBlockedAvatars(avs as any);
    toast.success(`@${username} unblocked`);
  };

  const handleUnmute = async (muteId: string, username: string, idx: number) => {
    setUnmutingId(muteId);
    try { await backendCapabilities.call('testagram.mutes.remove', { mute_id: muteId }); }
    catch (error) { setUnmutingId(''); toast.error(error instanceof Error?error.message:'Failed to unmute'); return; }
    setUnmutingId('');
    const ids = [...(muteIds as string[])];
    const unames = [...(mutedUsernames as string[])];
    const avs = [...(mutedAvatars as string[])];
    ids.splice(idx, 1);
    unames.splice(idx, 1);
    avs.splice(idx, 1);
    setMuteIds(ids as any);
    setMutedUsernames(unames as any);
    setMutedAvatars(avs as any);
    toast.success(`@${username} unmuted`);
  };

  if (!user) return null;

  // Pre-compute display values
  const bIds = blockIds as string[];
  const bUnames = blockedUsernames as string[];
  const bAvatars = blockedAvatars as string[];
  const mIds = muteIds as string[];
  const mUnames = mutedUsernames as string[];
  const mAvatars = mutedAvatars as string[];

  const blockedCountLabel = bIds.length !== 1 ? `${bIds.length} blocked users` : '1 blocked user';
  const mutedCountLabel = mIds.length !== 1 ? `${mIds.length} muted users` : '1 muted user';

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Blocked & Muted Users" showBack />

      {/* Tab bar */}
      <div className="sticky top-14 z-20 bg-background border-b border-border flex">
        <button
          onClick={() => setActiveTab(TAB_BLOCKED)}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === TAB_BLOCKED ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40'
          }`}
        >
          <UserX className="w-4 h-4" />
          Blocked
          {bIds.length > 0 && (
            <span className="text-[10px] bg-muted text-muted-foreground font-bold px-1.5 py-0.5 rounded-full">{bIds.length}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab(TAB_MUTED)}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === TAB_MUTED ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40'
          }`}
        >
          <VolumeX className="w-4 h-4" />
          Muted
          {mIds.length > 0 && (
            <span className="text-[10px] bg-muted text-muted-foreground font-bold px-1.5 py-0.5 rounded-full">{mIds.length}</span>
          )}
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {activeTab === TAB_BLOCKED && (
          <>
            {/* Info banner */}
            <div className="flex items-start gap-3 p-4 bg-muted/40 border border-border rounded-2xl">
              <Shield className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold">Blocked users</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Blocked users cannot see your posts, follow you, or send you messages.
                </p>
              </div>
            </div>

            {blockLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading blocked users…</span>
              </div>
            ) : bIds.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
                  <UserX className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="font-bold text-base">No blocked users</p>
                <p className="text-sm text-muted-foreground">Users you block will appear here.</p>
              </div>
            ) : (
              <div className="border border-border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 bg-muted/20 border-b border-border">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{blockedCountLabel}</p>
                </div>
                {bIds.map((blockId, i) => {
                  const uname = bUnames[i];
                  const avatar = bAvatars[i];
                  const isUnblocking = unblockingId === blockId;
                  const handle = formatHandle(uname);
                  return (
                    <div
                      key={blockId}
                      className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                        {avatar ? (
                          <img src={avatar} alt={uname} className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{handle}</p>
                        <p className="text-xs text-muted-foreground">Blocked</p>
                      </div>
                      <button
                        onClick={() => handleUnblock(blockId, uname, i)}
                        disabled={isUnblocking}
                        className="px-3 py-1.5 border border-border rounded-lg text-xs font-semibold hover:bg-muted transition-colors disabled:opacity-50 shrink-0 flex items-center gap-1.5"
                      >
                        {isUnblocking && <Loader2 className="w-3 h-3 animate-spin" />}
                        Unblock
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground px-4">
              To block a user, visit their profile and tap the ··· menu.
            </p>
          </>
        )}

        {activeTab === TAB_MUTED && (
          <>
            {/* Info banner */}
            <div className="flex items-start gap-3 p-4 bg-muted/40 border border-border rounded-2xl">
              <VolumeX className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold">Muted users</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Muted users' posts won't appear in your feed. They can still follow you and see your posts — they won't know they're muted.
                </p>
              </div>
            </div>

            {muteLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading muted users…</span>
              </div>
            ) : mIds.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
                  <VolumeX className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="font-bold text-base">No muted users</p>
                <p className="text-sm text-muted-foreground">Users you mute will appear here.</p>
              </div>
            ) : (
              <div className="border border-border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 bg-muted/20 border-b border-border">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{mutedCountLabel}</p>
                </div>
                {mIds.map((muteId, i) => {
                  const uname = mUnames[i];
                  const avatar = mAvatars[i];
                  const isUnmuting = unmutingId === muteId;
                  const handle = formatHandle(uname);
                  return (
                    <div
                      key={muteId}
                      className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                        {avatar ? (
                          <img src={avatar} alt={uname} className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{handle}</p>
                        <p className="text-xs text-muted-foreground">Muted — posts hidden from feed</p>
                      </div>
                      <button
                        onClick={() => handleUnmute(muteId, uname, i)}
                        disabled={isUnmuting}
                        className="px-3 py-1.5 border border-border rounded-lg text-xs font-semibold hover:bg-muted transition-colors disabled:opacity-50 shrink-0 flex items-center gap-1.5"
                      >
                        {isUnmuting && <Loader2 className="w-3 h-3 animate-spin" />}
                        Unmute
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground px-4">
              To mute a user, visit their profile and tap the ··· menu.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
