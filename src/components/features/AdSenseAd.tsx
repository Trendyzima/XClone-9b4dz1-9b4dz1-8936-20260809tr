import { TestagramAdSlot } from './TestagramAdSlot';

interface AdSenseAdProps {
  adSlot: string;
  adFormat?: 'auto' | 'fluid' | 'rectangle' | 'vertical' | 'horizontal';
  fullWidthResponsive?: boolean;
  className?: string;
  onAdLoad?: () => void;
  style?: React.CSSProperties;
}

/** Compatibility API: the former AdSense surface now renders Testagram Ads only. */
export function AdSenseAd({ adSlot, className = '', onAdLoad }: AdSenseAdProps) {
  void onAdLoad;
  const placement = adSlot === 'profile' ? 'PROFILE' : adSlot === 'explore' ? 'EXPLORE' : adSlot === 'feed-inline' ? 'HOME_FEED' : 'HOME_FEED';
  return <TestagramAdSlot placement={placement} className={className} />;
}

export function PageAdBanner() {
  return <TestagramAdSlot placement="PROFILE" className="mx-4 mt-2 mb-1" />;
}

export function FeedBannerAd({ className }: { className?: string }) {
  return <TestagramAdSlot placement="HOME_FEED" className={className} />;
}

export function InArticleAd({ className }: { className?: string }) {
  return <TestagramAdSlot placement="POST_DETAIL" className={className} />;
}
