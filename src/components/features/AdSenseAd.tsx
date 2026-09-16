import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@/lib/capacitor-stub';
import { ProfileRewardsRedemptionCard } from '@/components/features/ProfileRewardsRedemptionCard';
import { supabase } from '@/lib/supabase';

type ZenAd = {
  kind: 'display' | 'no_fill';
  impressionId?: string;
  headline?: string;
  body?: string;
  cta?: string;
  imageUrl?: string | null;
  clickThroughUrl?: string;
  sponsored?: boolean;
};

interface AdSenseAdProps {
  adSlot: string;
  adFormat?: 'auto' | 'fluid' | 'rectangle' | 'vertical' | 'horizontal';
  fullWidthResponsive?: boolean;
  className?: string;
  onAdLoad?: () => void;
  style?: React.CSSProperties;
}

async function requestZenAd(slotCode: string): Promise<ZenAd | null> {
  const { data, error } = await supabase.functions.invoke('zenad-decision', {
    body: {
      id: crypto.randomUUID(),
      appId: 'testagram',
      slotCode,
      responseFormat: 'json',
      user: { device: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop' },
      content: { genres: [], keywords: [] },
      privacy: { gdprApplies: false },
    },
  });
  if (error || !data || data.kind !== 'display') return null;
  return data as ZenAd;
}

function ZenAdCard({ ad, className = '' }: { ad: ZenAd; className?: string }) {
  const clicked = useRef(false);
  const handleClick = async () => {
    if (clicked.current) return;
    clicked.current = true;
    if (ad.impressionId) {
      void supabase.functions.invoke('zenad-event', {
        body: { impressionId: ad.impressionId, eventType: 'click' },
      });
    }
    if (ad.clickThroughUrl) window.open(ad.clickThroughUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={`rounded-xl border border-border/70 bg-card overflow-hidden ${className}`}>
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">Sponsored</span>
        <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded-sm bg-primary/10 text-primary border border-primary/15">Ad</span>
      </div>
      <button type="button" onClick={handleClick} className="w-full text-left p-3 pt-1 hover:bg-muted/20 transition-colors">
        <div className="flex gap-3 items-center">
          {ad.imageUrl && <img src={ad.imageUrl} alt="" className="w-20 h-16 rounded-lg object-cover shrink-0" loading="lazy" />}
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm truncate">{ad.headline}</p>
            {ad.body && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ad.body}</p>}
            <span className="inline-flex mt-2 px-2.5 py-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">{ad.cta ?? 'Learn more'}</span>
          </div>
        </div>
      </button>
    </div>
  );
}

export function AdSenseAd({ adSlot, className = '', onAdLoad }: AdSenseAdProps) {
  const isNative = Capacitor.isNativePlatform();
  const [ad, setAd] = useState<ZenAd | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isNative) return;
    let cancelled = false;
    requestZenAd(adSlot).then(result => {
      if (!cancelled) {
        setAd(result);
        setLoaded(true);
        if (result) onAdLoad?.();
      }
    });
    return () => { cancelled = true; };
  }, [adSlot, isNative, onAdLoad]);

  if (isNative || !loaded || !ad) return null;
  return <ZenAdCard ad={ad} className={className} />;
}

export function PageAdBanner() {
  const [ad, setAd] = useState<ZenAd | null>(null);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (isNative) return;
    let cancelled = false;
    requestZenAd('profile').then(result => { if (!cancelled) setAd(result); });
    return () => { cancelled = true; };
  }, [isNative]);

  return (
    <>
      <ProfileRewardsRedemptionCard />
      {!isNative && ad && <div className="mx-4 mt-2 mb-1"><ZenAdCard ad={ad} /></div>}
    </>
  );
}

export function FeedBannerAd({ className }: { className?: string }) {
  return <AdSenseAd adSlot="feed-top" adFormat="fluid" fullWidthResponsive className={className} />;
}

export function InArticleAd({ className }: { className?: string }) {
  return <AdSenseAd adSlot="feed-inline" adFormat="fluid" fullWidthResponsive className={className} />;
}

declare global {
  interface Window { adsbygoogle?: unknown[]; }
}
