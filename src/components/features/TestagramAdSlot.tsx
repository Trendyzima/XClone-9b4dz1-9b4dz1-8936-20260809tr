import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Megaphone, MoreHorizontal, ShieldCheck, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePremium } from '@/hooks/usePremium';

export type TestagramAdPlacement =
  | 'HOME_FEED' | 'FOLLOWING_FEED' | 'VIDEO_FEED' | 'REELS'
  | 'STORIES' | 'EXPLORE' | 'SEARCH' | 'PROFILE' | 'POST_DETAIL'
  | 'COMMUNITY' | 'THREAD' | 'MARKETPLACE' | 'PRODUCT' | 'SIDEBAR' | 'IPTV' | 'TV_CHANNELS';

export interface TestagramAdContext {
  content_id?: string;
  content_type?: string;
  author_id?: string;
  community_id?: string;
  query?: string;
  category?: string;
  page_path?: string;
  surface?: string;
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
  IPTV: 'iptv-overlay', TV_CHANNELS: 'tv-channels',
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

export function TestagramAdSlot({ placement, context, className = '', compact = false, dismissible = false }: {
  placement: TestagramAdPlacement;
  context?: TestagramAdContext;
  className?: string;
  /** Compact layout for video overlays; never changes serving or billing behavior. */
  compact?: boolean;
  /** Lets viewers dismiss a sponsored card without registering an ad click. */
  dismissible?: boolean;
}) {
  const { isActive: isPremium } = usePremium();
  const [ad, setAd] = useState<ServedAd | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const impressionRef = useRef<string>('');
  const eventTokenRef = useRef<string>('');
  const cardRef = useRef<HTMLElement | null>(null);
  const viewableSentRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const requestId = crypto.randomUUID();
    (async () => {
      setLoading(true);
      setDismissed(false);
      setAd(null);
      impressionRef.current = '';
      eventTokenRef.current = '';
      viewableSentRef.current = false;
      if (isPremium) { setLoading(false); return; }
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

  useEffect(() => {
    const node = cardRef.current;
    if (!node || !ad || viewableSentRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5);
      if (visible && !viewableSentRef.current) {
        viewableSentRef.current = true;
        event('viewable');
        observer.disconnect();
      }
    }, { threshold: [0.5] });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ad?.impression_id]);

  const event = (eventType: string, metadata: Record<string, unknown> = {}) => {
    const impressionId = impressionRef.current;
    const eventToken = eventTokenRef.current;
    if (!impressionId || !eventToken) return;
    supabase.functions.invoke('testagram-ads/event', {
      body: { impression_id: impressionId, event_type: eventType, event_token: eventToken, metadata: { placement, ...context, ...metadata } },
    }).catch(() => {});
  };

  if (isPremium || dismissed || loading || !isRealAd(ad)) return null;

  const isVideo = ad.format?.toLowerCase().includes('video');

  return (
    <article ref={cardRef} className={`relative rounded-2xl border border-border bg-card overflow-hidden shadow-sm ${compact ? 'text-xs' : ''} ${className}`} data-testagram-ad-placement={placement} data-campaign-id={ad.campaign_id}>
      {dismissible && <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss sponsored ad" className="absolute right-2 top-2 z-10 rounded-full border border-border bg-background/90 p-1.5 text-muted-foreground shadow-sm hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
      <button type="button" onClick={() => { event('click'); if (ad.click_through_url) window.open(ad.click_through_url, '_blank', 'noopener,noreferrer'); }} className="w-full text-left">
        <div className={`flex items-center justify-between gap-2 px-3 pt-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground ${compact ? 'pr-10' : ''}`}>
          <span className="inline-flex items-center gap-2"><Megaphone className="w-3 h-3" /> Sponsored · Testagram Ads</span>
          {!compact && <span className="inline-flex items-center gap-1 normal-case tracking-normal font-medium" title="Testagram Ads is the ad delivery system"><ShieldCheck className="w-3 h-3" /> Verified placement</span>}
        </div>
        {ad.asset_url ? (
          isVideo
            ? <video
                src={ad.asset_url}
                className={`w-full object-cover mt-2 bg-muted ${compact ? 'max-h-20' : 'max-h-[460px]'}`}
                muted playsInline preload="metadata"
                onPlay={() => event('video_start')}
                onTimeUpdate={(e) => {
                  const video = e.currentTarget;
                  if (!video.duration) return;
                  const ratio = video.currentTime / video.duration;
                  const sent = (video.dataset.milestones || '').split(',').filter(Boolean);
                  const milestone = ratio >= 0.95 ? 'video_complete' : ratio >= 0.75 ? 'video_third_quartile' : ratio >= 0.5 ? 'video_midpoint' : ratio >= 0.25 ? 'video_first_quartile' : '';
                  if (milestone && !sent.includes(milestone)) {
                    video.dataset.milestones = [...sent, milestone].join(',');
                    event(milestone, { progress: ratio });
                  }
                }}
              />
            : <img src={ad.asset_url} alt={ad.headline || 'Sponsored content'} className={`w-full object-cover mt-2 ${compact ? 'max-h-20' : 'max-h-[460px]'}`} loading="lazy" decoding="async" />
        ) : null}
        <div className="p-3">
          {ad.headline && <h3 className={`font-bold leading-tight ${compact ? 'pr-5 text-sm line-clamp-1' : 'text-base'}`}>{ad.headline}</h3>}
          {ad.body && <p className={`text-muted-foreground mt-1 ${compact ? 'line-clamp-2 text-xs' : 'text-sm line-clamp-3'}`}>{ad.body}</p>}
          <div className={`flex items-center justify-between gap-3 ${compact ? 'mt-2' : 'mt-3'}`}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">{ad.cta || 'Learn more'} <ExternalLink className="w-3 h-3" /></span>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><MoreHorizontal className="w-3 h-3" /> Ad</span>
          </div>
        </div>
      </button>
    </article>
  );
}
