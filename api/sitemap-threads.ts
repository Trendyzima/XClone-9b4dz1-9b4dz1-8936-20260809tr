import { degradedSitemapUrlset } from './sitemap-fallback';
import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const BASE = 'https://testagram.site';

function esc(value: string): string {
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

export default async function handler(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL || 'https://ffrhglgkukgsuhxenena.supabase.co';
  // Prefer a privileged key only when explicitly provisioned. The publishable key is public
  // by design and lets public-only sitemap queries work without asking for service secrets.
  const supabaseApiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya';
  if (!supabaseApiKey) return new Response('Sitemap temporarily unavailable',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  const db=createClient(supabaseUrl,supabaseApiKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const url=new URL(request.url);
  const rawPart=url.searchParams.get('part');
  const hasExplicitPart=rawPart!==null;
  const part=rawPart===null?0:Number(rawPart);
  if(rawPart!==null&&(!/^\d+$/.test(rawPart)||!Number.isSafeInteger(part)))return new Response('Invalid sitemap part',{status:400,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  const pageSize=50000;
  const {count,error:countError}=await db.from('threads').select('id',{count:'exact',head:true}).is('deleted_at',null).or('visibility.eq.public,visibility.is.null');
  if(countError){console.error('[sitemap-threads] count',countError);return degradedSitemapUrlset(request,'sitemap-threads');}
  const total=Number(count||0), parts=Math.max(1,Math.ceil(total/pageSize));
  if(!hasExplicitPart&&parts>1){
    const body=`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({length:parts},(_,i)=>`<sitemap><loc>${BASE}/api/sitemap-threads?part=${i}</loc></sitemap>`).join('')}</sitemapindex>`;
    return new Response(body,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, s-maxage=3600, stale-while-revalidate=21600'}});
  }
  if(part>=parts)return new Response('Sitemap part not found',{status:404});
  const from=part*pageSize,to=Math.min(from+pageSize-1,Math.max(0,total-1));
  const {data,error}=await db.from('threads').select('id,updated_at,created_at').is('deleted_at',null).or('visibility.eq.public,visibility.is.null').order('created_at',{ascending:false}).order('id',{ascending:false}).range(from,to);
  if(error){console.error('[sitemap-threads] query',error);return degradedSitemapUrlset(request,'sitemap-threads');}
  const urls=(data||[]).map(row=>`<url><loc>${BASE}/thread/${encodeURIComponent(String(row.id))}</loc>${row.updated_at||row.created_at?`<lastmod>${esc(String(row.updated_at||row.created_at))}</lastmod>`:''}<changefreq>daily</changefreq><priority>0.6</priority></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, s-maxage=3600, stale-while-revalidate=21600'}});
}
