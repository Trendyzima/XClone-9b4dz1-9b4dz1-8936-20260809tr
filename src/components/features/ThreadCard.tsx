import { useEffect, useState } from 'react';
import { Heart, MessageCircle, Repeat2, Share2, Eye } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { InlineTvSuggestion } from './InlineTvSuggestion';
import { InlineRssSuggestion } from './InlineRssSuggestion';

interface ThreadCardProps {
  thread: any;
}

export function ThreadCard({ thread }: ThreadCardProps) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(thread.user_profiles ?? thread.profile ?? null);

  useEffect(() => {
    let cancelled = false;
    if (profile || !thread.owner_id) return;
    supabase.from('profiles')
      .select('id,username,display_name,avatar_url,verified_tier')
      .eq('id', thread.owner_id)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled && data) setProfile(data); });
    return () => { cancelled = true; };
  }, [thread.owner_id, profile]);

  const username = String(profile?.username ?? '').replace(/^@/,'');
  const displayName = profile?.display_name ?? profile?.full_name ?? username ?? 'Profile';
  const avatar = profile?.avatar_url;
  const created = thread.created_at ? formatDistanceToNow(new Date(thread.created_at), { addSuffix: true }) : '';
  const body = thread.body ?? thread.content ?? '';
  const rawMedia = thread.media_urls ?? thread.mediaUrls ?? thread.attachments ?? [];
  const media = (Array.isArray(rawMedia) ? rawMedia : [])
    .map((item: any) => typeof item === 'string' ? item : (item?.url ?? item?.media_url ?? item?.mediaUrl))
    .filter(Boolean)
    .slice(0, 4);

  return (
    <article className="border-b border-border bg-background px-4 py-4 hover:bg-muted/20 transition-colors">
      <div className="flex gap-3">
        <button onClick={() => navigate('/profile/' + username)} className="shrink-0" aria-label={'Open ' + username + ' profile'}>
          {avatar ? <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover" loading="lazy" /> : <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold">{username.slice(0,1).toUpperCase()}</div>}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm">
            <button onClick={() => navigate('/profile/' + username)} className="font-bold hover:underline truncate">{displayName}</button>
            <span className="text-muted-foreground truncate">@{username}</span>
            {created && <><span className="text-muted-foreground">·</span><time className="text-muted-foreground">{created}</time></>}
          </div>
          {thread.title && <h3 className="font-bold mt-1">{thread.title}</h3>}
          {body && <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6">{body}</p>}
          <InlineTvSuggestion content={body} seed={String(thread.id)} type="thread" />
          <InlineRssSuggestion content={body} seed={`${String(thread.id)}-rss`} type="thread" />
          {media.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              {media.map((url: string, i: number) => /\.(mp4|webm|mov|m4v|ogv)(?:[?#].*)?$/i.test(url)
                ? <video key={i} src={url} controls playsInline preload="metadata" className="w-full max-h-64 object-cover rounded-xl border border-border" />
                : <img key={i} src={url} alt="" loading="lazy" decoding="async" className="w-full max-h-64 object-cover rounded-xl border border-border" />)}
            </div>
          )}
          <div className="flex items-center justify-between mt-3 max-w-lg text-muted-foreground">
            <button className="flex items-center gap-1.5 text-xs hover:text-primary"><MessageCircle className="w-4 h-4" />{thread.replies_count ?? 0}</button>
            <button className="flex items-center gap-1.5 text-xs hover:text-primary"><Repeat2 className="w-4 h-4" />{thread.reposts_count ?? 0}</button>
            <button className="flex items-center gap-1.5 text-xs hover:text-primary"><Heart className="w-4 h-4" />{thread.likes_count ?? 0}</button>
            <span className="flex items-center gap-1.5 text-xs"><Eye className="w-4 h-4" />{thread.views_count ?? 0}</span>
            <button className="flex items-center gap-1.5 text-xs hover:text-primary" aria-label="Share thread"><Share2 className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
    </article>
  );
}
