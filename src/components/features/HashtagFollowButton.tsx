import { useState, useEffect } from 'react';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Hash, Plus, Check, Loader2, TrendingUp, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/utils';

// ── Hashtag Follow Button ─────────────────────────────────────────────────────
interface HashtagFollowButtonProps {
  tag: string;
  hashtagId?: string;
  usageCount?: number;
  showCount?: boolean;
  compact?: boolean;
}

export function HashtagFollowButton({ tag, hashtagId, usageCount, showCount = true, compact = false }: HashtagFollowButtonProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolvedId, setResolvedId] = useState<string | null>(hashtagId ?? null);

  useEffect(() => {
    if (!user || !resolvedId) return;
    backendCapabilities.getHashtagFollowState(resolvedId).then(({ following }) => setFollowing(Boolean(following))).catch(() => setFollowing(false));
  }, [user?.id, resolvedId]);

  // Resolve hashtag id if not provided
  useEffect(() => {
    if (hashtagId) return;
    backendCapabilities.resolveHashtag(tag.replace(/^#/, '').toLowerCase())
      .then(data => setResolvedId(data.id)).catch(() => {});
  }, [tag, hashtagId]);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) { navigate('/auth'); return; }
    if (!resolvedId) {
      const data = await backendCapabilities.resolveHashtag(tag.replace(/^#/, '').toLowerCase());
      if (!data?.id) return;
      setResolvedId(data.id);
    }
    setLoading(true);
    if (following) {
      await backendCapabilities.setHashtagFollow(resolvedId!, false);
      setFollowing(false);
      toast.success(`Unfollowed #${tag.replace(/^#/, '')}`);
    } else {
      await backendCapabilities.setHashtagFollow(resolvedId!, true);
      setFollowing(true);
      toast.success(`Following #${tag.replace(/^#/, '')}!`);
    }
    setLoading(false);
  };

  if (compact) {
    return (
      <button onClick={toggle} disabled={loading}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all disabled:opacity-50 ${
          following
            ? 'bg-primary/15 border-primary/30 text-primary'
            : 'bg-muted/50 border-border text-muted-foreground hover:border-primary/30 hover:text-primary'
        }`}>
        {loading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : following ? <Check className="w-2.5 h-2.5" /> : <Plus className="w-2.5 h-2.5" />}
        {following ? 'Following' : 'Follow'}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={e => { e.stopPropagation(); navigate(`/hashtag/${tag.replace(/^#/, '')}`); }}
        className="flex items-center gap-1 text-primary hover:underline font-semibold text-sm">
        <Hash className="w-3.5 h-3.5" />{tag.replace(/^#/, '')}
        {showCount && usageCount && usageCount > 0 && (
          <span className="text-xs text-muted-foreground font-normal">({formatNumber(usageCount)})</span>
        )}
      </button>
      <button onClick={toggle} disabled={loading}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-all disabled:opacity-50 ${
          following
            ? 'bg-primary/15 border-primary/30 text-primary hover:bg-primary/20'
            : 'bg-muted/50 border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary'
        }`}>
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : following ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
        {following ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}

// ── Followed Hashtags Panel ───────────────────────────────────────────────────
export function FollowedHashtagsPanel({ onClose }: { onClose?: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [hashtags, setHashtags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    backendCapabilities.listFollowedHashtags()
      .then(({ items }) => setHashtags(items ?? []))
      .catch(error => { console.warn('[hashtags] Backend follow list unavailable', error); setHashtags([]); })
      .finally(() => setLoading(false));
  }, [user?.id]);

  if (!user) return null;

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm">Followed Hashtags</h3>
        </div>
        {onClose && <button onClick={onClose} className="p-1 rounded-full hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>}
      </div>
      <div className="p-3">
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : hashtags.length === 0 ? (
          <div className="text-center py-6">
            <Hash className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Follow hashtags to see them here</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {hashtags.map((h: any) => (
              <button key={h.id}
                onClick={() => navigate(`/hashtag/${h.tag}`)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-primary/8 border border-primary/20 text-primary text-xs font-semibold hover:bg-primary/15 transition-colors">
                <Hash className="w-3 h-3" />{h.tag}
                {h.usage_count > 0 && <span className="text-[10px] text-primary/60">{formatNumber(h.usage_count)}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline Hashtag Chip (for use in post content parsing) ─────────────────────
interface HashtagChipProps {
  tag: string;
}

export function HashtagChip({ tag }: HashtagChipProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showPopover, setShowPopover] = useState(false);
  const [hashtagData, setHashtagData] = useState<any | null>(null);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const cleanTag = tag.replace(/^#/, '').toLowerCase();

  const loadHashtag = async () => {
    const data = await backendCapabilities.resolveHashtag(cleanTag);
    setHashtagData(data);
    if (data && user) {
      const follow = await backendCapabilities.getHashtagFollowState(data.id);
      setFollowing(Boolean(follow.following));
    }
  };

  const toggleFollow = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) { navigate('/auth'); return; }
    if (!hashtagData) return;
    setLoading(true);
    if (following) {
      await backendCapabilities.setHashtagFollow(hashtagData.id, false);
      setFollowing(false);
      toast.success(`Unfollowed #${cleanTag}`);
    } else {
      await backendCapabilities.setHashtagFollow(hashtagData.id, true);
      setFollowing(true);
      toast.success(`Following #${cleanTag}!`);
    }
    setLoading(false);
  };

  return (
    <span className="relative inline-block">
      <button
        onClick={e => { e.stopPropagation(); navigate(`/hashtag/${cleanTag}`); }}
        onMouseEnter={() => { setShowPopover(true); loadHashtag(); }}
        onMouseLeave={() => setShowPopover(false)}
        className="text-primary font-semibold hover:underline"
      >
        #{cleanTag}
      </button>
      {showPopover && (
        <span
          className="absolute bottom-full left-0 mb-2 z-50 w-52 bg-background border border-border rounded-xl shadow-xl p-3 block"
          onMouseEnter={() => setShowPopover(true)}
          onMouseLeave={() => setShowPopover(false)}
        >
          <span className="flex items-center gap-1.5 mb-2 block">
            <Hash className="w-4 h-4 text-primary inline" />
            <span className="font-bold text-sm">{cleanTag}</span>
          </span>
          {hashtagData && (
            <span className="text-xs text-muted-foreground block mb-2">
              {formatNumber(hashtagData.usage_count ?? 0)} posts
            </span>
          )}
          <span className="flex gap-2 block">
            <button onClick={e => { e.stopPropagation(); navigate(`/hashtag/${cleanTag}`); }}
              className="flex-1 py-1.5 border border-border rounded-lg text-xs font-semibold hover:bg-muted transition-colors">
              View posts
            </button>
            <button onClick={toggleFollow} disabled={loading}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 ${
                following
                  ? 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20'
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}>
              {loading ? '…' : following ? '✓ Following' : '+ Follow'}
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
