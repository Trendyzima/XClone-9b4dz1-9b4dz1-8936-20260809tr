const CANONICAL_HOSTS = ['media.testagram.site', 'cdn.testagram.site'] as const;
const CANONICAL_MEDIA_HOST = 'media.testagram.site';

const LEGACY_PREFIXES = ['/media/', '/users/', '/profiles/', '/uploads/', '/avatars/', '/covers/', '/photos/', '/videos/'];

function normalizePath(pathname: string) {
  if (pathname.startsWith('/v1/')) return pathname;
  if (pathname.startsWith('/media/')) return '/v1/' + pathname.slice('/media/'.length);
  if (pathname.startsWith('/users/') || pathname.startsWith('/profiles/') || pathname.startsWith('/uploads/') || pathname.startsWith('/avatars/') || pathname.startsWith('/covers/') || pathname.startsWith('/photos/') || pathname.startsWith('/videos/')) return '/v1' + pathname;
  return pathname;
}

function looksLikeMediaPath(value: string) {
  return LEGACY_PREFIXES.some(prefix => value.startsWith(prefix))
    || /^(users|profiles|uploads|avatars|covers|photos|videos)\//.test(value);
}

function canonicalFromPath(value: string) {
  const raw = value.replace(/^\/+/, '');
  if (!raw) return null;
  const pathname = raw.startsWith('v1/') ? '/' + raw : normalizePath('/' + raw);
  if (!pathname.startsWith('/v1/')) return null;
  return `https://${CANONICAL_MEDIA_HOST}${pathname}`;
}

export function mediaCandidates(value: string): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];

  // Database rows may contain an object key rather than an absolute URL.
  // Promote those keys directly to Testagram's native CDN instead of asking
  // the application origin to serve /users/... and getting a page 404.
  const bare = canonicalFromPath(raw);
  if (bare) {
    return [...new Set([bare, raw])];
  }

  const candidates = [raw];
  try {
    const url = new URL(raw, window.location.origin);
    const host = url.hostname.toLowerCase();
    if (CANONICAL_HOSTS.includes(host as typeof CANONICAL_HOSTS[number])) {
      const normalizedPath = normalizePath(url.pathname);
      for (const targetHost of [CANONICAL_MEDIA_HOST, 'cdn.testagram.site']) {
        const next = new URL(url.toString());
        next.hostname = targetHost;
        next.pathname = normalizedPath;
        candidates.push(next.toString());
      }
    }
  } catch {
    // Keep the original URL; the browser will surface the actual load failure.
  }
  return [...new Set(candidates)];
}

export function nextMediaCandidate(current: string, failed: string): string | null {
  const candidates = mediaCandidates(current);
  const index = candidates.indexOf(failed);
  return index >= 0 && index + 1 < candidates.length ? candidates[index + 1] : null;
}
