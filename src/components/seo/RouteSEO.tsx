import { useLocation } from 'react-router-dom';
import { useSEO } from '@/hooks/useSEO';

const PUBLIC_ROUTES: Array<[RegExp, string, string]> = [
  [/^\/$/, 'Home', 'Testagram — social media, short videos, live conversations and communities.'],
  [/^\/explore\/?$/, 'Explore', 'Explore popular posts, creators, topics and communities on Testagram.'],
  [/^\/discover(?:\/.*)?$/, 'Discover', 'Discover creators, communities, popular content and Fediverse content on Testagram.'],
  [/^\/videos?\/?$/, 'Videos', 'Watch short videos and discover creators on Testagram.'],
  [/^\/shorts\/?$/, 'Short Videos', 'Watch and discover short videos on Testagram.'],
  [/^\/threads\/?$/, 'Threads', 'Join public conversations and discussions on Testagram.'],
  [/^\/thread\//, 'Thread', 'Read this public Testagram discussion and join the conversation.'],
  [/^\/post\//, 'Post', 'View this public Testagram post and join the conversation.'],
  [/^\/profile\//, 'Profile', 'View this public Testagram creator profile, posts and media.'],
  [/^\/c\//, 'Community', 'Explore this public Testagram community and its conversations.'],
  [/^\/communities\/?$/, 'Communities', 'Discover public Testagram communities and conversations.'],
  [/^\/hashtag\//, 'Hashtag', 'Explore public Testagram posts and conversations for this hashtag.'],
  [/^\/hashtags\/?$/, 'Hashtags', 'Discover popular hashtags and conversations on Testagram.'],
  [/^\/trending\//, 'Trending', 'Explore trending conversations and topics on Testagram.'],
  [/^\/challenge\//, 'Challenge', 'Explore this public Testagram challenge and its community.'],
  [/^\/spaces(?:\/.*)?$/, 'Live Spaces', 'Discover live conversations and spaces on Testagram.'],
  [/^\/stream\//, 'Live Stream', 'Watch this public Testagram live stream.'],
  [/^\/tv(?:\/.*)?$/, 'Testagram TV', 'Watch Testagram TV channels and live programming.'],
  [/^\/channel\//, 'Channel', 'Explore this public Testagram TV channel on Testagram.'],
  [/^\/news(?:\/.*)?$/, 'News', 'Discover news and publisher stories surfaced on Testagram.'],
  [/^\/fediverse(?:\/.*)?$/, 'Fediverse', 'Explore public Fediverse content and federated conversations on Testagram.'],
  [/^\/leaderboard(?:\/.*)?$/, 'Leaderboard', 'See public Testagram creator and community leaderboards.'],
  [/^\/premium\/?$/, 'Premium', 'Explore Testagram Premium features.'],
  [/^\/products\/?$/, 'Products', 'Discover products and creator commerce on Testagram.'],
  [/^\/marketplace\/?$/, 'Marketplace', 'Browse the Testagram marketplace.'],
  [/^\/shop\/?$/, 'Shop', 'Browse products available on Testagram.'],
  [/^\/p\//, 'Product', 'View this public product listing on Testagram.'],
  [/^\/seller\//, 'Seller', 'View this public Testagram seller storefront.'],
  [/^\/series\/?$/, 'Series', 'Discover public creator series on Testagram.'],
  [/^\/help\/?$/, 'Help', 'Get help using Testagram.'],
  [/^\/policy\/?$/, 'Content Policy', 'Read Testagram content policy.'],
  [/^\/privacy\/?$/, 'Privacy Policy', 'Read the Testagram privacy policy.'],
  [/^\/terms\/?$/, 'Terms of Service', 'Read the Testagram terms of service.'],
  [/^\/search\/?$/, 'Search', 'Search public Testagram profiles, posts, communities and topics.'],
  [/^\/ai\/?$/, 'AI', 'Explore AI features on Testagram.'],
  [/^\/iptv\/?$/, 'IPTV Player', 'Watch publicly available streams using the Testagram IPTV player.'],
];

const PRIVATE = [
  /^\/auth/, /^\/messages/, /^\/notifications/, /^\/wallet/, /^\/settings/, /^\/bookmarks/,
  /^\/history/, /^\/scheduled/, /^\/payouts/, /^\/creator-studio/, /^\/monetization/,
  /^\/analytics/, /^\/verify/, /^\/referral/, /^\/rewards/, /^\/platform-inbox/, /^\/interests/,
  /^\/notification-preferences/, /^\/lists/, /^\/my-ads/, /^\/create-ad/, /^\/start-stream/,
  /^\/ad-analytics/, /^\/ad-performance/, /^\/post-analytics/, /^\/boost-analytics/, /^\/boost-create/,
  /^\/admin/, /^\/fraud-detection/, /^\/seo-audit/, /^\/staff/, /^\/regulator/, /^\/team-chat/,
  /^\/appeals/, /^\/orders/, /^\/sessions/, /^\/blocked/, /^\/daily-rewards/, /^\/wishlist/,
  /^\/call\//
];

function routeMeta(pathname: string): [string, string, boolean] {
  if (PRIVATE.some(pattern => pattern.test(pathname))) return ['Testagram', 'Testagram private account area.', true];
  const match = PUBLIC_ROUTES.find(([pattern]) => pattern.test(pathname));
  if (match) return [match[1], match[2], false];
  if (/^\/(?:login|signup)/.test(pathname)) return ['Testagram', 'Sign in or create a Testagram account.', true];
  return ['Testagram', 'This Testagram page is not intended for search indexing.', true];
}

export function RouteSEO() {
  const { pathname, search } = useLocation();
  const [label, description, noindex] = routeMeta(pathname);
  const canonicalPath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  const canonical = canonicalPath || '/';

  useSEO({
    title: label === 'Testagram' ? undefined : label,
    description,
    url: canonical,
    noindex,
    type: /^\/post\//.test(pathname) || /^\/thread\//.test(pathname) || /^\/news\//.test(pathname) ? 'article' : 'website',
    fallbackOnly: true,
  });

  void search;
  return null;
}
