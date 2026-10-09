import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const base = 'https://testagram.site';
const sitemapPath = path.join(root, 'public', 'sitemap-static.xml');
const sourcePath = path.join(dist, 'index.html');

if (!fs.existsSync(sourcePath)) throw new Error('[SEO prerender] Vite dist/index.html is missing');
if (!fs.existsSync(sitemapPath)) throw new Error('[SEO prerender] public/sitemap-static.xml is missing');

const source = fs.readFileSync(sourcePath, 'utf8');
const sitemap = fs.readFileSync(sitemapPath, 'utf8');
const paths = new Set(['/tv', '/auth', '/c/null']);
for (const match of sitemap.matchAll(/<loc>(https:\/\/testagram\.site[^<]*)<\/loc>/g)) {
  const url = new URL(match[1]);
  if (url.origin === base && !url.search && !url.hash) paths.add(url.pathname);
}

function metadata(pathname) {
  if (pathname === '/auth') return { title: 'Sign In or Create an Account | Testagram', description: 'Sign in or create your Testagram account.', robots: 'noindex, nofollow', type: 'WebPage' };
  if (pathname === '/c/null' || pathname === '/c/undefined') return { title: 'Community Not Found | Testagram', description: 'This community URL is invalid or unavailable.', robots: 'noindex, nofollow', type: 'WebPage' };
  if (pathname === '/tv') return { title: 'TV Channels & Live Streams | Testagram', description: 'Browse public live TV channels, regional streams and community broadcasts on Testagram.', robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1', type: 'CollectionPage' };
  if (pathname === '/') return { title: 'Testagram — Social Media, Short Videos & Communities', description: 'Discover short videos, public profiles, communities, live spaces and trending conversations on Testagram.', robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1', type: 'WebSite' };
  const parts = pathname.split('/').filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const leaf = parts.at(-1) || 'Testagram';
  const label = leaf.replace(/[-_]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
  let title = label + ' | Testagram';
  let description = 'Explore public content and conversations on Testagram.';
  let type = 'WebPage';
  if (pathname.startsWith('/c/')) { title = label + ' Community | Testagram'; description = 'Explore the public ' + label + ' community and its conversations on Testagram.'; type = 'CollectionPage'; }
  else if (pathname.startsWith('/hashtag/')) { title = '#' + label + ' | Testagram'; description = 'Browse public posts tagged #' + label + ' on Testagram.'; type = 'CollectionPage'; }
  else if (pathname.startsWith('/trending/')) { title = 'Trending ' + label + ' | Testagram'; description = 'Explore public conversations and content trending around ' + label + ' on Testagram.'; type = 'CollectionPage'; }
  else if (pathname.startsWith('/profile/')) { title = '@' + label + ' on Testagram'; description = 'View the public Testagram profile for @' + label + '.'; type = 'ProfilePage'; }
  else if (pathname === '/news') { title = 'News & Current Events | Testagram'; description = 'Discover news and public discussion on Testagram.'; type = 'CollectionPage'; }
  else if (pathname === '/explore') { title = 'Explore | Testagram'; description = 'Discover creators, public posts, communities and trending topics on Testagram.'; type = 'CollectionPage'; }
  return { title, description, robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1', type };
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function render(pathname) {
  const meta = metadata(pathname);
  const canonical = base + (pathname === '/' ? '/' : pathname);
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const schema = JSON.stringify({ '@context': 'https://schema.org', '@type': meta.type, name: meta.title, description: meta.description, url: canonical, isPartOf: { '@type': 'WebSite', name: 'Testagram', url: base + '/' } }).replace(/</g, '\\u003c');
  let html = source
    .replace(/<title>[\s\S]*?<\/title>/i, '<title>' + title + '</title>')
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/i, '<meta name="description" content="' + description + '" />')
    .replace(/<meta name="robots" content="[^"]*"\s*\/?>/i, '<meta name="robots" content="' + meta.robots + '" />')
    .replace(/<meta name="googlebot" content="[^"]*"\s*\/?>/i, '<meta name="googlebot" content="' + meta.robots + '" />')
    .replace(/<link rel="canonical" href="[^"]*"\s*\/?>/i, '<link rel="canonical" href="' + canonical + '" />')
    .replace(/<meta property="og:url" content="[^"]*"\s*\/?>/i, '<meta property="og:url" content="' + canonical + '" />')
    .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/i, '<meta property="og:title" content="' + title + '" />')
    .replace(/<meta property="og:description" content="[^"]*"\s*\/?>/i, '<meta property="og:description" content="' + description + '" />')
    .replace(/<meta name="twitter:url" content="[^"]*"\s*\/?>/i, '<meta name="twitter:url" content="' + canonical + '" />')
    .replace(/<meta name="twitter:title" content="[^"]*"\s*\/?>/i, '<meta name="twitter:title" content="' + title + '" />')
    .replace(/<meta name="twitter:description" content="[^"]*"\s*\/?>/i, '<meta name="twitter:description" content="' + description + '" />');
  html = html.replace('</head>', '<script type="application/ld+json">' + schema + '</script>\n</head>');
  return html;
}

let generated = 0;
for (const pathname of paths) {
  if (pathname === '/' || pathname.includes('..') || pathname.includes('\\')) continue;
  const target = path.join(dist, pathname.replace(/^\/+/, ''), 'index.html');
  if (!target.startsWith(dist + path.sep)) throw new Error('[SEO prerender] Refusing path outside dist: ' + pathname);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, render(pathname), 'utf8');
  generated++;
}
console.log('[SEO prerender] Generated ' + generated + ' host-portable route documents from the static sitemap and critical SEO routes.');
