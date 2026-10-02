export type BannerAdPosition = string;

// ── Config (kept for call-site compatibility) ────────────────────────────────
export const ADMOB_CONFIG = {
  APP_ID:          '',
  BANNER_FEED:     '',
  BANNER_PROFILE:  '',
  BANNER_EXPLORE:  '',
  INTERSTITIAL:    '',
  REWARDED:        '',
  NATIVE:          '',
} as const;

export const AD_REVENUE_SPLIT = {
  CREATOR_SHARE:   0.30,
  PLATFORM_SHARE:  0.70,
  ESTIMATED_CPM: {
    banner:        0.80,
    interstitial:  4.50,
    rewarded:      8.00,
    native:        2.50,
  },
} as const;

/** Always false — AdMob is no longer active */
export function isAdMobSupported(): boolean {
  return false;
}

export async function initAdMob() {}

export async function showBanner(
  _adId?: string,
  _position?: BannerAdPosition,
  _margin?: number,
) {}

export async function hideBanner() {}

export async function showInterstitial(_adId?: string): Promise<boolean> {
  return false;
}

export async function showRewarded(_adId?: string): Promise<null> {
  return null;
}

export async function trackCreatorAdRevenue(_params: {
  supabase: any;
  creatorUserId: string;
  adType: 'banner' | 'interstitial' | 'rewarded';
  grossRevenue: number;
}) {}
