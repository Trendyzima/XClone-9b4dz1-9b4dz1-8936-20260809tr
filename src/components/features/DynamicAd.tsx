import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Capacitor } from '@/lib/capacitor-stub';
import { usePremium } from '@/hooks/usePremium';
import { ExternalLink, Megaphone } from 'lucide-react';

interface DynamicAdProps { location: 'feed_top' | 'feed_inline' | 'sidebar' | 'profile' | 'explore'; className?: string; }
interface ServedAd { ok: boolean; impression_id?: string; campaign_id?: string; creative_id?: string; format?: string; headline?: string; body?: string; cta?: string; asset_url?: string; click_through_url?: string; slot_code?: string; }

const SLOT_BY_LOCATION: Record<string,string> = {
  feed_top: 'feed-top', feed_inline: 'feed-inline', sidebar: 'feed-inline', profile: 'profile', explore: 'explore',
};

export function DynamicAd({ location, className = '' }: DynamicAdProps) {
  const [ad, setAd] = useState<ServedAd | null>(null);
  const [loading, setLoading] = useState(true);
  const { isActive: isPremium } = usePremium();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isPremium || Capacitor.isNativePlatform()) { setLoading(false); return; }
      try {
        const { data, error } = await supabase.functions.invoke('testagram-ads/serve', {
          body: { slot_code: SLOT_BY_LOCATION[location] ?? 'feed-inline', request_id: crypto.randomUUID() },
        });
        if (!cancelled && !error && data?.ok) setAd(data);
      } catch { /* ads are non-critical */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [location, isPremium]);

  const handleClick = () => {
    if (!ad?.impression_id) return;
    supabase.functions.invoke('testagram-ads/event', { body: { impression_id: ad.impression_id, event_type: 'click' } }).catch(() => {});
    if (ad.click_through_url) window.open(ad.click_through_url, '_blank', 'noopener,noreferrer');
  };

  if (isPremium || loading || !ad?.ok) return null;

  return (
    <article className={`rounded-2xl border border-border bg-card/80 overflow-hidden ${className}`}>
      <button type="button" onClick={handleClick} className="w-full text-left group">
        <div className="flex items-center gap-2 px-3 pt-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Megaphone className="w-3 h-3" /> Sponsored · Testagram Ads
        </div>
        {ad.asset_url ? (
          ad.format?.toLowerCase().includes('video') ? <video src={ad.asset_url} className="w-full max-h-[420px] object-cover mt-2" muted playsInline preload="metadata" /> : <img src={ad.asset_url} alt={ad.headline || 'Sponsored content'} className="w-full max-h-[420px] object-cover mt-2" loading="lazy" />
        ) : null}
        <div className="p-3">
          {ad.headline ? <h3 className="font-bold text-base leading-tight">{ad.headline}</h3> : null}
          {ad.body ? <p className="text-sm text-muted-foreground mt-1 line-clamp-3">{ad.body}</p> : null}
          <div className="flex items-center justify-between gap-3 mt-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">{ad.cta || 'Learn more'} <ExternalLink className="w-3 h-3" /></span>
            <span className="text-[10px] text-muted-foreground">Ad</span>
          </div>
        </div>
      </button>
    </article>
  );
}
