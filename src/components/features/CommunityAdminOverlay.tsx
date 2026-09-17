import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Settings, Users, Image as ImageIcon, UserPlus, X, Search, Check, Loader2, Trash2 } from 'lucide-react';

type CommunityRow = {
  id: string;
  name: string;
  display_name: string;
  icon_url: string | null;
  banner_url: string | null;
  owner_id: string;
  created_by: string;
};

type ProfileRow = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};

const ADMIN_ROLES = new Set(['owner', 'moderator', 'admin']);

export function CommunityAdminOverlay() {
  const { user } = useAuth();
  const location = useLocation();
  const [community, setCommunity] = useState<CommunityRow | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'appearance' | 'members'>('appearance');
  const [savingImage, setSavingImage] = useState<'icon' | 'banner' | null>(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ProfileRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const communityName = useMemo(() => {
    const match = location.pathname.match(/^\/c\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setCommunity(null);
      setIsAdmin(false);
      setOpen(false);
      if (!user || !communityName) return;
      const { data: row } = await supabase
        .from('communities')
        .select('id,name,display_name,icon_url,banner_url,owner_id,created_by')
        .eq('name', communityName)
        .maybeSingle();
      if (!row || cancelled) return;
      const { data: member } = await supabase
        .from('community_members')
        .select('role,status')
        .eq('community_id', row.id)
        .eq('user_id', user.id)
        .maybeSingle();
      const allowed = row.owner_id === user.id || row.created_by === user.id || (member?.status === 'active' && ADMIN_ROLES.has(member.role));
      if (!cancelled) {
        setCommunity(row as CommunityRow);
        setIsAdmin(allowed);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [user?.id, communityName]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!open || tab !== 'members' || !community || !user) return;
      const q = search.trim();
      if (!q) { setResults([]); return; }
      const { data: existing } = await supabase
        .from('community_members')
        .select('user_id')
        .eq('community_id', community.id);
      const existingIds = new Set((existing ?? []).map(row => row.user_id));
      let query = supabase
        .from('user_profiles')
        .select('id,username,display_name,avatar_url')
        .neq('id', user.id)
        .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
        .limit(12);
      const { data } = await query;
      if (!cancelled) setResults((data ?? []).filter(profile => !existingIds.has(profile.id)) as ProfileRow[]);
    };
    const timer = window.setTimeout(run, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, tab, search, community?.id, user?.id]);

  if (!isAdmin || !community) return null;

  const uploadImage = async (kind: 'icon' | 'banner', file: File) => {
    setSavingImage(kind);
    setMessage(null);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `communities/${community.id}/${kind}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('tv49-profile-media').upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('tv49-profile-media').getPublicUrl(path);
      const field = kind === 'icon' ? 'icon_url' : 'banner_url';
      const { error: updateError } = await supabase.from('communities').update({ [field]: data.publicUrl }).eq('id', community.id);
      if (updateError) throw updateError;
      setCommunity(prev => prev ? { ...prev, [field]: data.publicUrl } : prev);
      setMessage(`${kind === 'icon' ? 'Profile image' : 'Cover image'} updated.`);
    } catch (error: any) {
      setMessage(error?.message || 'Could not update image.');
    } finally {
      setSavingImage(null);
    }
  };

  const removeImage = async (kind: 'icon' | 'banner') => {
    const field = kind === 'icon' ? 'icon_url' : 'banner_url';
    setSavingImage(kind);
    setMessage(null);
    try {
      const { error } = await supabase.from('communities').update({ [field]: null }).eq('id', community.id);
      if (error) throw error;
      setCommunity(prev => prev ? { ...prev, [field]: null } : prev);
      setMessage(`${kind === 'icon' ? 'Profile image' : 'Cover image'} removed.`);
    } catch (error: any) {
      setMessage(error?.message || 'Could not remove image.');
    } finally {
      setSavingImage(null);
    }
  };

  const addMembers = async () => {
    if (!selected.length || adding) return;
    setAdding(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc('add_community_members', { p_community_id: community.id, p_user_ids: selected });
      if (error) throw error;
      setMessage(`${Number(data ?? 0)} member${Number(data ?? 0) === 1 ? '' : 's'} added.`);
      setSelected([]);
      setSearch('');
      setResults([]);
    } catch (error: any) {
      setMessage(error?.message || 'Could not add members.');
    } finally {
      setAdding(false);
    }
  };

  const toggleSelected = (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setMessage(null); }}
        className="fixed right-4 bottom-20 z-[120] rounded-full bg-primary text-primary-foreground shadow-lg px-4 py-2.5 flex items-center gap-2 text-xs font-bold hover:opacity-90"
        aria-label="Open community admin"
      >
        <Settings className="w-4 h-4" /> Admin
      </button>

      {open && (
        <div className="fixed inset-0 z-[300] bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setOpen(false)}>
          <div className="w-full sm:max-w-lg bg-background rounded-t-3xl sm:rounded-3xl max-h-[88vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-background border-b border-border px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Community Admin</p>
                <h2 className="font-bold text-lg">{community.display_name}</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
            </div>

            <div className="grid grid-cols-2 border-b border-border">
              <button type="button" onClick={() => setTab('appearance')} className={`py-3 text-sm font-semibold ${tab === 'appearance' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}><ImageIcon className="inline w-4 h-4 mr-1" />Appearance</button>
              <button type="button" onClick={() => setTab('members')} className={`py-3 text-sm font-semibold ${tab === 'members' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}><Users className="inline w-4 h-4 mr-1" />Members</button>
            </div>

            {tab === 'appearance' && (
              <div className="p-5 space-y-5">
                <div>
                  <p className="text-sm font-bold mb-2">Profile image</p>
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-2xl overflow-hidden bg-muted border border-border shrink-0">
                      {community.icon_url ? <img src={community.icon_url} alt="Community profile" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ImageIcon className="w-7 h-7" /></div>}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <label className="cursor-pointer px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold">Change<input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && uploadImage('icon', e.target.files[0])} /></label>
                      {community.icon_url && <button type="button" onClick={() => removeImage('icon')} className="px-3 py-2 rounded-xl border border-border text-xs font-semibold"><Trash2 className="inline w-3.5 h-3.5 mr-1" />Remove</button>}
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-bold mb-2">Cover image</p>
                  <div className="rounded-2xl overflow-hidden bg-muted border border-border aspect-[3/1] mb-3">
                    {community.banner_url ? <img src={community.banner_url} alt="Community cover" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ImageIcon className="w-7 h-7" /></div>}
                  </div>
                  <div className="flex gap-2">
                    <label className="cursor-pointer px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold">Change<input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && uploadImage('banner', e.target.files[0])} /></label>
                    {community.banner_url && <button type="button" onClick={() => removeImage('banner')} className="px-3 py-2 rounded-xl border border-border text-xs font-semibold"><Trash2 className="inline w-3.5 h-3.5 mr-1" />Remove</button>}
                  </div>
                </div>
                {savingImage && <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving image…</p>}
              </div>
            )}

            {tab === 'members' && (
              <div className="p-5 space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search username or name…" className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary" />
                </div>
                {results.length > 0 && (
                  <div className="border border-border rounded-2xl divide-y divide-border overflow-hidden">
                    {results.map(profile => {
                      const checked = selected.includes(profile.id);
                      return <button type="button" key={profile.id} onClick={() => toggleSelected(profile.id)} className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-muted/50">
                        <div className="w-9 h-9 rounded-full bg-muted overflow-hidden shrink-0">{profile.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{profile.username?.[0]?.toUpperCase() || '?'}</div>}</div>
                        <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{profile.display_name || profile.username}</p><p className="text-xs text-muted-foreground truncate">@{profile.username}</p></div>
                        <span className={`w-6 h-6 rounded-full border flex items-center justify-center ${checked ? 'bg-primary border-primary text-primary-foreground' : 'border-border'}`}>{checked && <Check className="w-4 h-4" />}</span>
                      </button>;
                    })}
                  </div>
                )}
                {search.trim() && results.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No eligible users found.</p>}
                <button type="button" onClick={addMembers} disabled={!selected.length || adding} className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                  {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  {selected.length ? `Add ${selected.length} member${selected.length === 1 ? '' : 's'}` : 'Select members'}
                </button>
                <p className="text-[11px] text-muted-foreground">Only community owners and existing community admins can perform this action. Existing members are automatically excluded.</p>
              </div>
            )}

            {message && <div className="mx-5 mb-5 rounded-xl bg-muted px-3 py-2 text-xs font-medium">{message}</div>}
          </div>
        </div>
      )}
    </>
  );
}
