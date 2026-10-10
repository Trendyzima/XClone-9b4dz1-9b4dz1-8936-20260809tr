import { useLocation } from 'react-router-dom';
import { ExternalAdEngine } from './ExternalAdEngine';
import { TestagramAdSlot, type TestagramAdPlacement } from './TestagramAdSlot';
import { usePremium } from '@/hooks/usePremium';

const EXCLUDED_PATH = /^\/(?:auth|login|signup|register|forgot-password|reset-password|password-reset|admin|settings|account|security|billing|subscription|invoice|wallet|messages|notifications|help|premium|create-ad|my-ads|ad-|rewards|verify|profile\/complete|privacy|terms|policy|regulator|sessions|call|checkout|payment|mpesa|deposit|withdraw|tv-studio|start-stream|blocked|appeals|payouts|revenue|analytics)(?:\/|$)/;

function placementFor(pathname: string): TestagramAdPlacement {
  if (pathname === '/' || pathname === '/home' || pathname.startsWith('/home/')) return 'HOME_FEED';
  if (pathname === '/videos' || pathname.startsWith('/videos/')) return 'VIDEO_FEED';
  if (pathname === '/shorts' || pathname.startsWith('/shorts/')) return 'REELS';
  if (pathname === '/explore' || pathname.startsWith('/discover')) return 'EXPLORE';
  if (pathname === '/search' || pathname.startsWith('/search/')) return 'SEARCH';
  if (pathname.startsWith('/profile/')) return 'PROFILE';
  if (pathname.startsWith('/community') || pathname.startsWith('/communities')) return 'COMMUNITY';
  if (pathname.startsWith('/thread') || pathname.startsWith('/threads') || pathname.startsWith('/post/')) return 'THREAD';
  if (pathname.startsWith('/story') || pathname.startsWith('/stories')) return 'STORIES';
  if (pathname.startsWith('/marketplace')) return 'MARKETPLACE';
  if (pathname.startsWith('/product/')) return 'PRODUCT';
  return 'HOME_FEED';
}

export function SiteAdInjector() {
  const { pathname } = useLocation();
  const { isActive: isPremium } = usePremium();

  // IPTV is a full-screen embedded app; its ad slots must be rendered inside
  // that shell rather than underneath its fixed, high-z-index iframe.
  if (isPremium || pathname === '/iptv' || pathname.startsWith('/tv/live/') || EXCLUDED_PATH.test(pathname)) return null;

  return (
    <div className="site-monetization-stack" data-ad-route={pathname}>
      <ExternalAdEngine surface="top" />
      <div className="mx-auto w-full max-w-2xl px-3">
        <TestagramAdSlot
          placement={placementFor(pathname)}
          context={{ page_path: pathname, surface: 'route_top' }}
          className="mx-auto my-2 max-w-xl"
          compact
        />
      </div>
    </div>
  );
}
