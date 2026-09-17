import { BannerAdPosition } from '@/lib/capacitor-stub';
import { DynamicAd } from './DynamicAd';

interface HybridAdProps {
  location: 'feed_top' | 'feed_inline' | 'sidebar' | 'profile' | 'explore';
  className?: string;
  position?: BannerAdPosition;
}

/** Compatibility surface: removes the former AdSense/AdMob split and delegates to Testagram Ads. */
export function HybridAdComponent({ location, className = '' }: HybridAdProps) {
  return <DynamicAd location={location} className={className} />;
}
