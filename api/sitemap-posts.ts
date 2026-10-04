import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffrhglgkukgsuhxenena.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const BASE = 'https://testagram.site';

function esc(value: string): string {
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

export default async function handler(request: Request) {
  if (!SERVICE_ROLE_KEY) return new Response('Sitemap temporarily unavailable',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  const db=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const url=new URL(request.url);
  const part=Math.max(0,Math.floor(Number(url.searchParams.get('part')||'0')));
  const pageSize=50000;
  const {count,error:countError}=await db.from('posts').select('id',{count:'exact',head:true}).is('deleted_at',null).or('visibility.eq.public,visibility.is.null');
  if(countError)return new Response('Sitemap temporarily unavailable',{status:502});
  const total=Number(count||0), parts=Math.max(1,Math.ceil(total/pageSize));
  if(part===0&&parts>1){
    const body=`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({length:parts},(_,i)=>`<sitemap><loc>${BASE}/api/sitemap-posts?part=${i}</loc></sitemap>`).join('')}</sitemapindex>`;
    return new Response(body,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, s-maxage=3600, stale-while-revalidate=21600'}});
  }
  if(part>=parts)return new Response('Sitemap part not found',{status:404});
  const from=part*pageSize,to=Math.min(from+pageSize-1,Math.max(0,total-1));
  const {data,error}=await db.from('posts').select('id,updated_at,created_at').is('deleted_at',null).or('visibility.eq.public,visibility.is.null').order('created_at',{ascending:false}).order('id',{ascending:false}).range(from,to);
  if(error)return new Response('Sitemap temporarily unavailable',{status:502});
  const urls=(data||[]).map(row=>`<url><loc>${BASE}/post/${encodeURIComponent(String(row.id))}</loc>${row.updated_at||row.created_at?`<lastmod>${esc(String(row.updated_at||row.created_at))}</lastmod>`:''}<changefreq>daily</changefreq><priority>0.6</priority></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, s-maxage=3600, stale-while-revalidate=21600'}});
}
