import { ExternalAdEngine } from './ExternalAdEngine';

/** A feed slot that disappears entirely when the network returns no creative. */
export function FeedAdCard() {
  return <ExternalAdEngine surface="feed" />;
}
