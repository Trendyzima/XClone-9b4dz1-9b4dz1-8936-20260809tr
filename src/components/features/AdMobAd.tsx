import { BannerAdPosition } from '@/lib/capacitor-stub';
import { TestagramAdSlot } from './TestagramAdSlot';

interface AdMobAdProps {
  adId?: string;
  type: 'banner' | 'interstitial' | 'rewarded';
  position?: BannerAdPosition;
  onAdLoaded?: () => void;
  onAdFailed?: (error: any) => void;
  onRewarded?: (reward: any) => void;
}

/** Compatibility API: platform ad inventory is now owned by Testagram Ads. */
export function AdMobAd({ type, onAdLoaded }: AdMobAdProps) {
  void onAdLoaded;
  if (type !== 'banner') return null;
  return <TestagramAdSlot placement="HOME_FEED" />;
}

/** Hook kept for call-site compatibility. Interstitial/rewarded monetization is outside the ad-slot contract. */
export const useAdMob = () => ({
  showInterstitial: async (_id?: string) => false,
  showRewarded: async (_id?: string) => null,
  showBanner: async (_id?: string, _pos?: BannerAdPosition) => {},
  hideBanner: async () => {},
});
