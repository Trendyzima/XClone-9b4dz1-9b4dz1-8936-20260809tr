const CANONICAL_HOSTS = ['media.testagram.site', 'cdn.testagram.site'] as const;

function normalizePath(pathname: string) {
  if (pathname.startsWith('/media/')) return '/v1/' + pathname.slice('/media/'.length);
  if (pathname.startsWith('/users/') || pathname.startsWith('/profiles/') || pathname.startsWith('/uploads/') || pathname.startsWith('/avatars/') || pathname.startsWith('/covers/') || pathname.startsWith('/photos/') || pathname.startsWith('/videos/')) return '/v1' + pathname;
  return pathname;
}

export function mediaCandidates(value: string): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const candidates = [raw];
  try {
    const url = new URL(raw, window.location.origin);
    const host = url.hostname.toLowerCase();
    if (CANONICAL_HOSTS.includes(host as typeof CANONICAL_HOSTS[number])) {
      const normalizedPath = normalizePath(url.pathname);
      for (const targetHost of [host, 'media.testagram.site', 'cdn.testagram.site']) {
        const next = new URL(url.toString());
        next.hostname = targetHost;
        next.pathname = normalizedPath;
        candidates.push(next.toString());
      }
      if (host === 'cdn.testagram.site' && url.pathname.startsWith('/media/')) {
        const next = new URL(url.toString());
        next.pathname = '/v1/' + url.pathname.slice('/media/'.length);
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
