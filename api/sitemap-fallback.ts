const BASE = 'https://testagram.site';
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

export function degradedSitemapUrlset(request: Request, source: string): Response {
  console.error('[seo-sitemap] dynamic data unavailable for ' + source);
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="' + NS + '">\n</urlset>\n';
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=900', 'X-Sitemap-Data-Status': 'degraded', 'X-Sitemap-Source': source, 'X-Content-Type-Options': 'nosniff' } });
}

export function degradedSitemapIndex(request: Request): Response {
  console.error('[seo-sitemap] dynamic counts unavailable; serving static-first index');
  const paths = ['/sitemap-static.xml', '/api/sitemap-users?part=0', '/api/sitemap-community?part=0', '/api/sitemap-posts?part=0', '/api/sitemap-threads?part=0'];
  const entries = paths.map(path => '  <sitemap><loc>' + BASE + path + '</loc></sitemap>').join('\n');
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="' + NS + '">\n' + entries + '\n</sitemapindex>\n';
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=900', 'X-Sitemap-Data-Status': 'degraded', 'X-Content-Type-Options': 'nosniff' } });
}
