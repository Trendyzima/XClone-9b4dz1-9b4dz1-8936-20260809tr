import { TestagramAdSlot } from './TestagramAdSlot';

/** Native Testagram sponsored inventory used wherever the feed inserts an ad card. */
export function FeedAdCard() {
  return <TestagramAdSlot placement="HOME_FEED" context={{ page_path: '/', surface: 'feed_inline' }} className="mx-3 my-3" />;
}
