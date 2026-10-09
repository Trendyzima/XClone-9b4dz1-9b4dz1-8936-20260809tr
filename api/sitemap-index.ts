import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const BASE = 'https://testagram.site';
const PAGE_SIZE = 50_000;

type SitemapSource = { path: string; count: number };

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function xmlResponse(body: string, request: Request, status = 200): Response {
  return new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=21600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export default async function handler(request: Request): Promise<Response> {
  const supabaseUrl = process.env.SUPABASE_URL || 'https://ffrhglgkukgsuhxenena.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  }
  if (!serviceRoleKey) {
    return new Response('Sitemap temporarily unavailable', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  try {
    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const [profiles, communities, posts, threads] = await Promise.all([
      db.from('profiles').select('id', { count: 'exact', head: true })
        .eq('discoverable_by_username', true).eq('account_status', 'active').eq('visibility', 'public'),
      db.from('communities').select('id', { count: 'exact', head: true })
        .eq('visibility', 'public').eq('is_private', false),
      db.from('posts').select('id', { count: 'exact', head: true })
        .is('deleted_at', null).or('visibility.eq.public,visibility.is.null'),
      db.from('threads').select('id', { count: 'exact', head: true })
        .is('deleted_at', null).or('visibility.eq.public,visibility.is.null'),
    ]);

    const failed = [profiles, communities, posts, threads].some(result => result.error);
    if (failed) {
      console.error('[sitemap-index] count query failed', [profiles.error, communities.error, posts.error, threads.error].filter(Boolean));
      return new Response('Sitemap temporarily unavailable', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    const sources: SitemapSource[] = [
      { path: '/api/sitemap-users', count: Number(profiles.count ?? 0) },
      { path: '/api/sitemap-community', count: Number(communities.count ?? 0) },
      { path: '/api/sitemap-posts', count: Number(posts.count ?? 0) },
      { path: '/api/sitemap-threads', count: Number(threads.count ?? 0) },
    ];

    const locations = [
      `  <sitemap><loc>${xmlEscape(BASE + '/sitemap-static.xml')}</loc></sitemap>`,
      ...sources.flatMap(source => Array.from(
        { length: Math.max(1, Math.ceil(source.count / PAGE_SIZE)) },
        (_, part) => `  <sitemap><loc>${xmlEscape(`${BASE}${source.path}?part=${part}`)}</loc></sitemap>`,
      )),
    ];

    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations.join('\n')}\n</sitemapindex>\n`;
    return xmlResponse(body, request);
  } catch (error) {
    console.error('[sitemap-index] unexpected failure', error);
    return new Response('Sitemap temporarily unavailable', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
}
