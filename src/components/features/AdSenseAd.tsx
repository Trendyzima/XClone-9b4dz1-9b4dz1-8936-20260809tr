import { useEffect, useRef } from 'react';
import { useIsNative } from '@/hooks/useIsNative';
import { ZenAdCard } from './ZenAdCard';
import { ProfileRewardsRedemptionCard } from './ProfileRewardsRedemptionCard';

interface AdSenseAdProps {
  adSlot: string;
  adFormat?: string;
  fullWidthResponsive?: boolean;
  className?: string;
}

export function AdSenseAd({ adSlot, adFormat = 'auto', fullWidthResponsive = true, className = '' }: AdSenseAdProps) {
  const insRef = useRef<HTMLModElement>(null);
  const isNative = useIsNative();

  useEffect(() => {
    if (isNative || !insRef.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (error) {
      console.debug('[adsense] unavailable', error);
    }
  }, [isNative]);

  if (isNative) return null;

  return (
    <div className={`overflow-hidden ${className}`}>
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client="ca-pub-2458567543017441"
        data-ad-slot={adSlot}
        data-ad-format={adFormat}
        data-full-width-responsive={fullWidthResponsive ? 'true' : 'false'}
      />
    </div>
  );
}

export function FeedBannerAd({ className }: { className?: string }) {
  return <AdSenseAd adSlot="feed-top" adFormat="fluid" fullWidthResponsive className={className} />;
}

export function InArticleAd({ className }: { className?: string }) {
  return <AdSenseAd adSlot="feed-inline" adFormat="fluid" fullWidthResponsive className={className} />;
}
