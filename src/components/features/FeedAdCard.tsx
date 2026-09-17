import { DynamicAd } from './DynamicAd';

/** Native Testagram sponsored inventory used wherever the feed inserts an ad card. */
export function FeedAdCard() {
  return <DynamicAd location="feed-inline" className="border-b border-border rounded-none" />;
}
