import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffrhglgkukgsuhxenena.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export default async function handler() {
  if (!SERVICE_ROLE_KEY) {
    return new Response('Sitemap temporarily unavailable', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const requestedPart = Math.max(0, Math.floor(Number(new URL(request.url).searchParams.get('part') || '0')));
  const { count, error: countError } = await db
    .from('communities')
    .select('id', { count: 'exact', head: true })
    .eq('visibility', 'public')
    .eq('is_private', false);
  if (countError) {
    console.error('[sitemap-community] count', countError);
    return new Response('Sitemap temporarily unavailable', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const total = Number(count ?? 0);
  const partCount = Math.max(1, Math.ceil(total / 50000));
  if (requestedPart === 0 && partCount > 1) {
    const indexEntries = Array.from({ length: partCount }, (_, part) =>
      `  <sitemap>\n    <loc>https://testagram.site/api/sitemap-community?part=${part}</loc>\n  </sitemap>`
    ).join('\\n');
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexEntries}\n</sitemapindex>\n`;
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=21600' } });
  }
  if (requestedPart >= partCount) return new Response('Sitemap part not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  const from = requestedPart * 50000;
  const to = Math.min(from + 49999, Math.max(0, total - 1));
  const { data, error } = await db
    .from('communities')
    .select('slug,updated_at')
    .eq('visibility', 'public')
    .eq('is_private', false)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);
  if (error) {
    console.error('[sitemap-community]', error);
    return new Response('Sitemap temporarily unavailable', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const urls = (data ?? []).filter((row) => row.slug).map((row) => {

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=21600',
    },
  });
}
