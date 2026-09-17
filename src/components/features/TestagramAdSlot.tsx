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
  event_token?: string;
}

const SLOT: Record<TestagramAdPlacement, string> = {
  HOME_FEED: 'feed-top', FOLLOWING_FEED: 'feed-inline', VIDEO_FEED: 'video-feed',
  REELS: 'reels', STORIES: 'story', EXPLORE: 'explore', SEARCH: 'search',
  PROFILE: 'profile', POST_DETAIL: 'post-detail', COMMUNITY: 'community',
  THREAD: 'post-detail', MARKETPLACE: 'explore', PRODUCT: 'explore', SIDEBAR: 'feed-inline',
};

function isRealAd(value: ServedAd | null | undefined): value is ServedAd {
  if (!value?.ok || !value.impression_id || !value.campaign_id || !value.creative_id || !value.event_token) return false;
  const hasMessage = Boolean(value.headline?.trim() || value.body?.trim());
  const hasAsset = Boolean(value.asset_url?.trim());
  const hasDestination = Boolean(value.click_through_url?.trim());
  // Never render a shell/placeholder as an ad. A valid Testagram ad needs
  // identifiable campaign lineage plus meaningful creative or a destination.
  return hasMessage || hasAsset || hasDestination;
}

export function TestagramAdSlot({ placement, context, className = '' }: {
  placement: TestagramAdPlacement;
  context?: TestagramAdContext;
  className?: string;
}) {
  const { isActive: isPremium } = usePremium();
  const [ad, setAd] = useState<ServedAd | null>(null);
  const [loading, setLoading] = useState(true);
  const impressionRef = useRef<string>('');
  const eventTokenRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    const requestId = crypto.randomUUID();
    (async () => {
      setLoading(true);
      setAd(null);
      impressionRef.current = '';
      eventTokenRef.current = '';
      if (isPremium || Capacitor.isNativePlatform()) { setLoading(false); return; }
      try {
        const { data, error } = await supabase.functions.invoke('testagram-ads/serve', {
          body: { slot_code: SLOT[placement], request_id: requestId, placement, context: context ?? {} },
        });
        if (!cancelled && !error && isRealAd(data)) {
          impressionRef.current = data.impression_id!;
          eventTokenRef.current = data.event_token!;
          setAd(data);
        }
      } catch { /* advertising is non-critical to content rendering */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [placement, JSON.stringify(context ?? {}), isPremium]);

  const event = (eventType: string) => {
    const impressionId = impressionRef.current;
    const eventToken = eventTokenRef.current;
    if (!impressionId || !eventToken) return;
    supabase.functions.invoke('testagram-ads/event', {
      body: { impression_id: impressionId, event_type: eventType, event_token: eventToken, metadata: { placement, ...context } },
    }).catch(() => {});
  };

  if (isPremium || loading || !isRealAd(ad)) return null;

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
