import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@/lib/capacitor-stub';
import { ProfileRewardsRedemptionCard } from '@/components/features/ProfileRewardsRedemptionCard';

interface AdSenseAdProps {
  adSlot: string;
  adFormat?: 'auto' | 'fluid' | 'rectangle' | 'vertical' | 'horizontal';
  fullWidthResponsive?: boolean;
  className?: string;
  onAdLoad?: () => void;
  style?: React.CSSProperties;
}

/**
 * Google AdSense Ad Component — collapses when unfilled (no reserved space).
 * Client: ca-pub-2458567543017441
 * Only renders on web (not native app).
 */
export function AdSenseAd({
  adSlot,
  adFormat = 'fluid',
  fullWidthResponsive = true,
  className = '',
  onAdLoad,
  style,
}: AdSenseAdProps) {
  const adRef = useRef(null);
  const pushed = useRef(false);
  const [filled, setFilled] = useState(null);

  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (isNative) return;
    if (pushed.current) return;
    const timer = setTimeout(() => {
      try {
        if (typeof window !== 'undefined') {
          ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
          pushed.current = true;
          onAdLoad?.();
        }
      } catch (_) {}
    }, 200);

    const checkFill = () => {
      const el = adRef.current;
      if (!el) { setFilled(false); return; }
      const status = el.getAttribute('data-ad-status');
      if (status === 'unfilled') { setFilled(false); return; }
      setFilled(el.children.length > 0 || (el as any).offsetHeight > 4);
    };
    const t1 = setTimeout(checkFill, 1800);
    const t2 = setTimeout(checkFill, 3500);

    return () => { clearTimeout(timer); clearTimeout(t1); clearTimeout(t2); };
  }, [adSlot, isNative, onAdLoad]);

  if (isNative) return null;
  if (filled === false) return null;

  return (
    <div className={`adsense-wrapper ${className}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Sponsored</span>
        <span className="text-[9px] font-bold uppercase tracking-widest px-1 py-0.5 rounded-sm bg-amber-500/10 text-amber-500 border border-amber-500/15">Ad</span>
      </div>
      <ins
        ref={adRef}
        className="adsbygoogle"
        style={{ display: 'block', ...style }}
        data-ad-client="ca-pub-2458567543017441"
        data-ad-slot={adSlot}
        data-ad-format={adFormat}
        data-ad-layout={adFormat === 'fluid' ? 'in-article' : undefined}
        data-full-width-responsive={fullWidthResponsive.toString()}
      />
    </div>
  );
}

/**
 * PageAdBanner — profile pages also expose the authenticated owner's
 * reward-to-cash control here so the large ProfilePage can stay untouched.
 * The redemption card itself checks the route and profile ownership.
 */
export function PageAdBanner() {
  const pushed = useRef(false);
  const insRef = useRef(null);
  const [filled, setFilled] = useState(null);

  useEffect(() => {
    if (pushed.current) return;
    pushed.current = true;
    try { ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({}); } catch (_) {}

    const checkFill = () => {
      const el = insRef.current;
      if (!el) { setFilled(false); return; }
      const status = el.getAttribute('data-ad-status');
      if (status === 'unfilled') { setFilled(false); return; }
      setFilled(el.children.length > 0 || (el as any).offsetHeight > 4);
    };
    const t1 = setTimeout(checkFill, 1800);
    const t2 = setTimeout(checkFill, 3500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <>
      <ProfileRewardsRedemptionCard />
      {filled === true && (
        <div className="mx-4 mt-2 mb-1 rounded-xl overflow-hidden border border-border/60 bg-muted/5">
          <div className="flex items-center gap-1.5 px-3 pt-2 pb-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50">Sponsored</span>
            <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded-sm bg-amber-500/10 text-amber-500 border border-amber-500/15">Ad</span>
          </div>
          <ins
            ref={insRef}
            className="adsbygoogle"
            style={{ display: 'block' }}
            data-ad-client="ca-pub-2458567543017441"
            data-ad-slot="2031881558"
            data-ad-format="fluid"
            data-ad-layout="in-article"
            data-full-width-responsive="true"
          />
        </div>
      )}
    </>
  );
}

export function FeedBannerAd({ className }: { className?: string }) {
  return (
    <AdSenseAd
      adSlot="4099641690"
      adFormat="fluid"
      fullWidthResponsive
      className={className}
    />
  );
}

export function InArticleAd({ className }: { className?: string }) {
  return (
    <AdSenseAd
      adSlot="4099641690"
      adFormat="fluid"
      fullWidthResponsive
      className={className}
    />
  );
}

declare global {
  interface Window { adsbygoogle: any[]; }
}
