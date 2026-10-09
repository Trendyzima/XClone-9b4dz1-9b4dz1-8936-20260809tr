import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const sourcePath = path.join(dist, 'index.html');
if (!fs.existsSync(sourcePath)) {
  throw new Error('[seo-prerender] dist/index.html is missing; run Vite before prerendering SEO routes');
}
const template = fs.readFileSync(sourcePath, 'utf8');

const routes = [
  {
    path: '/tv',
    title: 'Live TV Channels & Public Streams | Testagram',
    description: 'Explore public live TV channels and community broadcasts on Testagram.',
    indexable: true,
  },
  {
    path: '/tv/channels',
    title: 'Live TV Channels & Public Streams | Testagram',
    description: 'Browse public live TV channels by region and category on Testagram.',
    indexable: true,
  },
  {
    path: '/tv/reels',
    title: 'TV Reels & Live Channel Clips | Testagram',
    description: 'Discover live channel playback and TV content on Testagram.',
    indexable: true,
  },
  {
    path: '/auth',
    title: 'Sign in or Create an Account | Testagram',
    description: 'Sign in to your Testagram account or create a new account.',
    indexable: false,
  },
  {
    path: '/c/null',
    title: 'Community Not Found | Testagram',
    description: 'This community URL is invalid or unavailable on Testagram.',
    indexable: false,
  },
];

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderRouteHtml(route) {
  const canonical = 'https://testagram.site' + route.path;
  const robots = route.indexable
    ? 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1'
    : 'noindex, nofollow';
  let html = template;
  html = html.replace(/<title>[^<]*<\/title>/i, '<title>' + escapeHtml(route.title) + '</title>');
  html = html.replace(/<meta name="description" content="[^"]*"\s*\/>/i, '<meta name="description" content="' + escapeHtml(route.description) + '" />');
  html = html.replace(/<meta name="robots" content="[^"]*"\s*\/>/i, '<meta name="robots" content="' + robots + '" />');
  html = html.replace(/<meta name="googlebot" content="[^"]*"\s*\/>/i, '<meta name="googlebot" content="' + robots + '" />');
  html = html.replace(/<link rel="canonical" href="[^"]*"\s*\/>/i, '<link rel="canonical" href="' + canonical + '" />');
  html = html.replace(/<meta property="og:url" content="[^"]*"\s*\/>/i, '<meta property="og:url" content="' + canonical + '" />');
  html = html.replace(/<meta property="og:title" content="[^"]*"\s*\/>/i, '<meta property="og:title" content="' + escapeHtml(route.title) + '" />');
  html = html.replace(/<meta property="og:description" content="[^"]*"\s*\/>/i, '<meta property="og:description" content="' + escapeHtml(route.description) + '" />');
  html = html.replace(/<meta name="twitter:url" content="[^"]*"\s*\/>/i, '<meta name="twitter:url" content="' + canonical + '" />');
  html = html.replace(/<meta name="twitter:title" content="[^"]*"\s*\/>/i, '<meta name="twitter:title" content="' + escapeHtml(route.title) + '" />');
  html = html.replace(/<meta name="twitter:description" content="[^"]*"\s*\/>/i, '<meta name="twitter:description" content="' + escapeHtml(route.description) + '" />');
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: route.title,
    description: route.description,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'Testagram', url: 'https://testagram.site/' },
  };
  html = html.replace('</head>', '<script type="application/ld+json">' + JSON.stringify(schema).replace(/</g, '\\u003c') + '</script>\n</head>');
  return html;
}

for (const route of routes) {
  const target = path.join(dist, route.path.replace(/^\/+/, ''), 'index.html');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderRouteHtml(route), 'utf8');
  const html = fs.readFileSync(target, 'utf8');
  if (!html.includes('<title>' + escapeHtml(route.title) + '</title>')) throw new Error('[seo-prerender] title verification failed for ' + route.path);
  if (!html.includes('<link rel="canonical" href="' + 'https://testagram.site' + route.path + '" />')) throw new Error('[seo-prerender] canonical verification failed for ' + route.path);
  if (!html.includes('<meta name="robots" content="' + (route.indexable ? 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1' : 'noindex, nofollow') + '" />')) throw new Error('[seo-prerender] robots verification failed for ' + route.path);
  process.stdout.write('[seo-prerender] PASS ' + route.path + ' (' + (route.indexable ? 'indexable' : 'noindex') + ')\n');
}
process.stdout.write('[seo-prerender] Generated ' + routes.length + ' provider-independent route documents.\n');
