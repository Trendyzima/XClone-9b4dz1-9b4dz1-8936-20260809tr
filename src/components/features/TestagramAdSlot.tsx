import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Megaphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePremium } from '@/hooks/usePremium';
import { Capacitor } from '@/lib/capacitor-stub';

export type TestagramAdPlacement =
  | 'HOME_FEED' | 'FOLLOWING_FEED' | 'VIDEO_FEED' | 'REELS'
  | 'STORIES' | 'EXPLORE' | 'SEARCH' | 'PROFILE' | 'POST_DETAIL'
  | 'COMMUNITY' | 'THREAD' | 'MARKETPLACE' | 'PRODUCT' | 'SIDEBAR';

export interface TestagramAdContext {
  content_id?: string;
  content_type?: string;
  author_id?: string;
  community_id?: string;
  query?: string;
  category?: string;
}

interface ServedAd {
  ok?: boolean;
  impression_id?: string;
  campaign_id?: string;
  creative_id?: string;
  format?: string;
  headline?: string;
  body?: string;
  cta?: string;
  asset_url?: string;
  click_through_url?: string;
  slot_code?: string;
}

const SLOT: Record<TestagramAdPlacement, string> = {
  HOME_FEED: 'feed-top', FOLLOWING_FEED: 'feed-inline', VIDEO_FEED: 'video-feed',
  REELS: 'reels', STORIES: 'stories', EXPLORE: 'explore', SEARCH: 'search',
  PROFILE: 'profile', POST_DETAIL: 'post-detail', COMMUNITY: 'community',
  THREAD: 'post-detail', MARKETPLACE: 'explore', PRODUCT: 'explore', SIDEBAR: 'feed-inline',
};

export function TestagramAdSlot({ placement, context, className = '' }: {
  placement: TestagramAdPlacement;
  context?: TestagramAdContext;
  className?: string;
}) {
  const { isActive: isPremium } = usePremium();
  const [ad, setAd] = useState<ServedAd | null>(null);
  const [loading, setLoading] = useState(true);
  const requestRef = useRef<string>('');
  const impressionRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    const requestId = crypto.randomUUID();
    requestRef.current = requestId;
    (async () => {
      if (isPremium || Capacitor.isNativePlatform()) { setLoading(false); return; }
      try {
        const { data, error } = await supabase.functions.invoke('testagram-ads/serve', {
          body: { slot_code: SLOT[placement], request_id: requestId, placement, context: context ?? {} },
        });
        if (!cancelled && !error && data?.ok && data.impression_id) {
          impressionRef.current = data.impression_id;
          setAd(data);
        }
      } catch { /* advertising is non-critical to content rendering */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [placement, JSON.stringify(context ?? {}), isPremium]);

  const event = (eventType: string) => {
    const impressionId = impressionRef.current;
    if (!impressionId) return;
    supabase.functions.invoke('testagram-ads/event', {
      body: { impression_id: impressionId, event_type: eventType, metadata: { placement, ...context } },
    }).catch(() => {});
  };

  if (isPremium || loading || !ad?.ok) return null;

  return (
    <article className={`rounded-2xl border border-border bg-card overflow-hidden ${className}`} data-testagram-ad-placement={placement}>
      <button type="button" onClick={() => { event('click'); if (ad.click_through_url) window.open(ad.click_through_url, '_blank', 'noopener,noreferrer'); }} className="w-full text-left">
        <div className="flex items-center gap-2 px-3 pt-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Megaphone className="w-3 h-3" /> Sponsored · Testagram Ads
        </div>
        {ad.asset_url ? (
          ad.format?.toLowerCase().includes('video')
            ? <video src={ad.asset_url} className="w-full max-h-[460px] object-cover mt-2" muted playsInline preload="metadata" />
            : <img src={ad.asset_url} alt={ad.headline || 'Sponsored content'} className="w-full max-h-[460px] object-cover mt-2" loading="lazy" />
        ) : null}
        <div className="p-3">
          {ad.headline && <h3 className="font-bold text-base leading-tight">{ad.headline}</h3>}
          {ad.body && <p className="text-sm text-muted-foreground mt-1 line-clamp-3">{ad.body}</p>}
          <div className="flex items-center justify-between gap-3 mt-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">{ad.cta || 'Learn more'} <ExternalLink className="w-3 h-3" /></span>
            <span className="text-[10px] text-muted-foreground">Ad</span>
          </div>
        </div>
      </button>
    </article>
  );
}
