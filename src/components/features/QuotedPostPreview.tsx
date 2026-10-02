import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Quote, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { parseContent } from '@/lib/utils';

type QuotedPost = {
  id: string;
  content: string;
  created_at: string;
  author_id?: string | null;
  user_id?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  profiles?: {
    id: string;
    username?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
  } | null;
};

export function QuotedPostPreview({ quotedPostId }: { quotedPostId?: string | null }) {
  const navigate = useNavigate();
  const [post, setPost] = useState<QuotedPost | null>(null);
  const [loading, setLoading] = useState(Boolean(quotedPostId));

  useEffect(() => {
    let cancelled = false;
    if (!quotedPostId || /^https:\/\//i.test(quotedPostId)) {
      setPost(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    void supabase
      .from('posts')
      .select('id,content,created_at,author_id,user_id,image_url,video_url,profiles!posts_author_id_fkey(id,username,display_name,avatar_url)')
      .eq('id', quotedPostId)
      .is('deleted_at', null)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('[quote-origin] unable to resolve origin', error);
          setPost(null);
        } else {
          setPost((data as QuotedPost | null) ?? null);
        }
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [quotedPostId]);

  if (!quotedPostId) return null;

  if (loading) {
    return (
      <div className="mt-3 rounded-2xl border border-border p-3 text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading quoted post…
      </div>
    );
  }

  if (!post) {
    return (
      <div className="mt-3 rounded-2xl border border-border p-3 text-xs text-muted-foreground flex items-center gap-2">
        <Quote className="w-3.5 h-3.5" />
        Original post unavailable
      </div>
    );
  }

  const profile: NonNullable<QuotedPost['profiles']> = post.profiles ?? { id: '' };
  const username = String(profile.username ?? '').replace(/^@/, '');
  const displayName = String(profile.display_name ?? username ?? 'Profile').trim();

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        navigate('/post/' + encodeURIComponent(post.id));
      }}
      className="mt-3 w-full text-left rounded-2xl border border-border bg-muted/10 hover:bg-muted/20 transition-colors overflow-hidden"
      aria-label={`Open original post by ${username ? '@' + username : displayName}`}
    >
      <div className="px-3 pt-3 flex items-center gap-2">
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt={displayName} className="w-7 h-7 rounded-full object-cover bg-muted" loading="lazy" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-xs font-semibold truncate">{displayName}</div>
          {username && <div className="text-[11px] text-muted-foreground truncate">@{username}</div>}
        </div>
        <Quote className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
      </div>
      <div className="px-3 pb-3 pt-2">
        <div
          className="text-sm whitespace-pre-wrap break-words line-clamp-6"
          dangerouslySetInnerHTML={{ __html: parseContent(post.content ?? '') }}
        />
        {post.image_url && (
          <img src={post.image_url} alt="" className="mt-2 max-h-56 w-full rounded-xl object-cover" loading="lazy" />
        )}
        {post.video_url && !post.image_url && (
          <div className="mt-2 rounded-xl bg-muted px-3 py-4 text-xs text-muted-foreground">Original post contains video</div>
        )}
        <div className="mt-2 text-[11px] font-medium text-primary">View original post →</div>
      </div>
    </button>
  );
}
