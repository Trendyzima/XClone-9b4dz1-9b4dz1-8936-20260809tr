import { ExternalAdEngine } from './ExternalAdEngine';

/**
 * Feed-native fallback for social feed inventory.
 * The external provider owns the creative; this component only provides the
 * in-feed placement and the visible Sponsored disclosure.
 */
export function FeedAdCard() {
  return (
    <div className="mx-3 my-3 overflow-hidden rounded-2xl border border-border bg-card" data-social-feed-ad="exoclick-display">
      <ExternalAdEngine surface="feed" />
    </div>
  );
}
