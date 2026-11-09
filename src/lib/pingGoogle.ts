const SITEMAP_URL = 'https://testagram.site/sitemap.xml';
const PING_COOLDOWN_MS = 60_000;

// Closure-scoped mutable state — NOT module-level to avoid esbuild non-determinism
const _ping = { lastAt: 0 };

export async function pingGoogleSitemap(): Promise<void> {
  const now = Date.now();
  if (now - _ping.lastAt < PING_COOLDOWN_MS) return;
  _ping.lastAt = now;
  try {
    await fetch(
      `https://www.google.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`,
      { method: 'GET', mode: 'no-cors', cache: 'no-store' }
    );
    console.log('[SEO] Pinged Google sitemap');
  } catch {
    // ignore
  }
  // Sitemap refresh is owned by the Backend/Data Centre scheduled ingestion pipeline.
  // The browser never calls a legacy Edge Function.
}
