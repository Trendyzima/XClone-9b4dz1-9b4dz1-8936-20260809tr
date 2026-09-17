import { TestagramAdSlot, TestagramAdPlacement } from './TestagramAdSlot';

interface DynamicAdProps { location: 'feed_top' | 'feed_inline' | 'sidebar' | 'profile' | 'explore'; className?: string; }

const PLACEMENT: Record<DynamicAdProps['location'], TestagramAdPlacement> = {
  feed_top: 'HOME_FEED',
  feed_inline: 'HOME_FEED',
  sidebar: 'SIDEBAR',
  profile: 'PROFILE',
  explore: 'EXPLORE',
};

/** Compatibility API. New code should use TestagramAdSlot directly. */
export function DynamicAd({ location, className = '' }: DynamicAdProps) {
  return <TestagramAdSlot placement={PLACEMENT[location]} className={className} />;
}
