import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Users, Loader2 } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { toast } from 'sonner';

interface Community {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  icon_url: string | null;
  banner_url: string | null;
  member_count: number;
  post_count: number;
  is_private: boolean;
}

export function CommunitySpotlightStrip({ initialCommunities }: { initialCommunities?: Community[] }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [communities, setCommunities] = useState<Community[]>(initialCommunities ?? []);
  const [loading, setLoading] = useState(initialCommunities === undefined);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const joinRes = user ? await supabase.from('community_members').select('community_id').eq('user_id', user.id) : { data: [] as any[] };
      if (initialCommunities === undefined) {
        const { data } = await supabase.from('communities').select('id, name, display_name, description, icon_url, banner_url, member_count, post_count, is_private').eq('is_private', false).order('member_count', { ascending: false }).limit(8);
        setCommunities(data || []);
      } else setCommunities(initialCommunities);
      setJoinedIds(new Set((joinRes.data || []).map((r: any) => r.community_id)));
      setLoading(false);
    })();
  }, [user?.id, initialCommunities]);

  const handleJoin = async (e: React.MouseEvent, community: Community) => {
    e.stopPropagation();
    if (!user) { navigate('/auth'); return; }
    if (joiningId) return;

    setJoiningId(community.id);
    const isJoined = joinedIds.has(community.id);

    try {
      if (isJoined) {
        await supabase
          .from('community_members')
          .delete()
          .eq('community_id', community.id)
          .eq('user_id', user.id);
        setJoinedIds(prev => { const s = new Set(prev); s.delete(community.id); return s; });
        toast.success(`Left ${community.display_name}`);
      } else {
        await supabase.from('community_members').insert({
          community_id: community.id,
          user_id: user.id,
          role: 'member',
        });
        setJoinedIds(prev => new Set([...prev, community.id]));
        toast.success(`Joined ${community.display_name}!`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    } finally {
      setJoiningId(null);
    }
  };

  if (loading) {
    return (
      <div className="border-b border-border py-3 px-4">
        <div className="flex items-center gap-2 mb-2.5">
          <Users className="w-4 h-4 text-blue-500" />
          <span className="font-bold text-sm">Communities</span>
        </div>
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="shrink-0 w-36 h-[88px] rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (communities.length === 0) return null;

  return (
    <div className="border-b border-border bg-gradient-to-r from-blue-500/5 via-background to-indigo-500/5 py-3">
      <div className="flex items-center gap-2 px-4 mb-2.5">
        <Users className="w-4 h-4 text-blue-500 shrink-0" />
        <h3 className="font-bold text-sm text-foreground">Communities</h3>
        <span className="text-[10px] font-bold text-blue-500/70 bg-blue-500/10 px-1.5 py-0.5 rounded-full">
          Active
        </span>
        <button
          onClick={() => navigate('/communities')}
          className="ml-auto text-xs text-primary font-semibold hover:underline"
        >
          See all →
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-1">
        {communities.map((community, i) => {
          const isJoined = joinedIds.has(community.id);
          const isFeatured = i === 0;

          return (
            <button
              key={community.id}
              onClick={() => navigate(`/c/${community.name}`)}
              className={`shrink-0 relative rounded-2xl overflow-hidden bg-card border border-border hover:border-primary/40 hover:scale-[1.03] active:scale-[0.98] transition-all focus:outline-none text-left shadow-sm ${
                isFeatured ? 'w-48' : 'w-36'
              }`}
              style={{ height: isFeatured ? 112 : 96 }}
            >
              {/* Banner / gradient background */}
              {community.banner_url ? (
                <img
                  src={community.banner_url}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div
                  className="absolute inset-0"
                  style={{
                    background: `hsl(${(community.name.charCodeAt(0) * 37) % 360}deg 60% 30%)`,
                  }}
                />
              )}

              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

              {/* Featured badge */}
              {isFeatured && (
                <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-primary/90 backdrop-blur-sm rounded-full text-[8px] font-black text-primary-foreground uppercase tracking-wider">
                  #1
                </div>
              )}

              {/* Community icon */}
              <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/20 backdrop-blur-sm overflow-hidden flex items-center justify-center">
                {community.icon_url ? (
                  <img src={community.icon_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white text-[10px] font-black">
                    {community.display_name[0]?.toUpperCase()}
                  </span>
                )}
              </div>

              {/* Info + Join button */}
              <div className="absolute bottom-0 left-0 right-0 p-2.5">
                <p className="text-white text-[11px] font-bold truncate leading-tight">
                  {community.display_name}
                </p>
                <div className="flex items-center justify-between mt-1.5 gap-1">
                  <span className="text-white/60 text-[9px] flex items-center gap-0.5">
                    <Users className="w-2.5 h-2.5" />
                    {formatNumber(community.member_count)}
                  </span>
                  <button
                    onClick={(e) => handleJoin(e, community)}
                    disabled={joiningId === community.id}
                    className={`shrink-0 flex items-center justify-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-black transition-all active:scale-95 ${
                      isJoined
                        ? 'bg-white/20 text-white/70 border border-white/20'
                        : 'bg-primary text-primary-foreground hover:opacity-90'
                    }`}
                  >
                    {joiningId === community.id ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    ) : isJoined ? (
                      'Joined'
                    ) : (
                      '+ Join'
                    )}
                  </button>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}