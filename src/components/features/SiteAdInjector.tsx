import { useLocation } from 'react-router-dom';
import { ExternalAdEngine } from './ExternalAdEngine';

function excluded(pathname: string) {
  return /^(\/auth|\/admin|\/settings|\/wallet|\/messages|\/notifications|\/help|\/premium|\/create-ad|\/my-ads|\/ad-|\/rewards|\/verify|\/privacy|\/terms|\/policy|\/regulator|\/sessions|\/call|\/checkout|\/payment|\/mpesa|\/deposit|\/withdraw|\/tv-studio|\/start-stream|\/blocked|\/appeals|\/payouts|\/revenue|\/analytics)/.test(pathname);
}

export function SiteAdInjector() {
  const { pathname } = useLocation();
  const shouldShow = !excluded(pathname);
  if (!shouldShow) return null;
  return <ExternalAdEngine surface="top" />;
}
