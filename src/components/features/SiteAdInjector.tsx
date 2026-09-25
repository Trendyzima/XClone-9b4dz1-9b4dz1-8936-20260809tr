import { useLocation } from 'react-router-dom';
import { TestagramAdSlot, TestagramAdPlacement } from './TestagramAdSlot';

function resolvePlacement(pathname: string): TestagramAdPlacement | null {
  if (pathname === '/' || pathname.startsWith('/home')) return 'HOME_FEED';
  if (pathname === '/explore' || pathname.startsWith('/discover') || pathname.startsWith('/trending')) return 'EXPLORE';
  if (pathname === '/search' || pathname.startsWith('/hashtag')) return 'SEARCH';
  if (pathname.startsWith('/profile/')) return 'PROFILE';
  if (pathname.startsWith('/post/') || pathname.startsWith('/post-remote')) return 'POST_DETAIL';
  if (pathname.startsWith('/thread/')) return 'THREAD';
  if (pathname.startsWith('/c/') || pathname.startsWith('/communities')) return 'COMMUNITY';
  if (pathname.startsWith('/videos') || pathname.startsWith('/shorts')) return 'VIDEO_FEED';
  if (pathname.startsWith('/marketplace') || pathname.startsWith('/shop') || pathname.startsWith('/products') || pathname.startsWith('/p/')) return 'MARKETPLACE';
  return null;
}

function excluded(pathname: string) {
  return /^(\/auth|\/admin|\/settings|\/wallet|\/messages|\/notifications|\/help|\/premium|\/create-ad|\/my-ads|\/ad-|\/rewards|\/verify|\/privacy|\/terms|\/policy|\/regulator|\/sessions|\/blocked|\/appeals|\/payouts|\/revenue|\/analytics)/.test(pathname);
}

export function SiteAdInjector() {
  const { pathname } = useLocation();
  const placement = excluded(pathname) ? null : resolvePlacement(pathname);
  if (!placement) return null;
  const context = { page_path: pathname, surface: placement };
  return (
    <div className="px-3 pt-3 pb-1">
      <TestagramAdSlot placement={placement} context={context} />
    </div>
  );
}
