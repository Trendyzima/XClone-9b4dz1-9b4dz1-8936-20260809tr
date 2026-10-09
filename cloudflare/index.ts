import { DEPLOYED_COMMIT_SHA } from './deployment-meta';
import homeFeed from '../api/home-feed';
import sitemapIndex from '../api/sitemap-index';
import sitemapUsers from '../api/sitemap-users';
import sitemapCommunity from '../api/sitemap-community';
import sitemapPosts from '../api/sitemap-posts';
import sitemapThreads from '../api/sitemap-threads';

const SUPABASE_ORIGIN = 'https://ffrhglgkukgsuhxenena.supabase.co';

type Env = {
  ASSETS: Fetcher;
  RATE_LIMITER: { limit(input: { key: string }): Promise<{ success: boolean }> };
  [key: string]: unknown;
};

const EDGE_ROUTES: Record<string, string> = {
  '/api/capability': '../api/capability',
  '/api/health': '../api/health',
  '/api/ready': '../api/ready',
  '/api/home-discovery': '../api/home-discovery',
  '/api/home-feed': '../api/home-feed',
  '/api/live': '../api/live',
  '/api/sitemap-index': '../api/sitemap-index',
  '/api/sitemap-users': '../api/sitemap-users',
  '/api/sitemap-posts': '../api/sitemap-posts',
  '/api/sitemap-threads': '../api/sitemap-threads',
  '/api/sitemap-community': '../api/sitemap-community',
};

const STATIC_SITEMAP_ROUTES: Record<string, (request: Request) => Promise<Response>> = {
  '/api/sitemap-index': sitemapIndex,
  '/api/sitemap-users': sitemapUsers,
  '/api/sitemap-community': sitemapCommunity,
  '/api/sitemap-posts': sitemapPosts,
  '/api/sitemap-threads': sitemapThreads,
};

const NODE_ROUTES: Record<string, string> = {
  '/api/media': '../api/media',
  '/api/auth/send-sms': '../api/auth/send-sms',
  '/api/story-cleanup': '../api/story-cleanup',
  '/api/news': '../api/news',
  '/api/email/send': '../api/email/send',
};

function setRuntimeEnv(env: Env, commit?: string) {
  const current = (globalThis as any).process?.env ?? {};
  (globalThis as any).process = {
    ...(globalThis as any).process,
    env: {
      ...current,
      ...Object.fromEntries(Object.entries(env).filter(([key]) =>
        /^[A-Z0-9_]+$/.test(key) && typeof valueOf(env, key) === 'string'
      ).map(([key]) => [key, String(valueOf(env, key))])),
      TESTAGRAM_COMMIT_SHA: commit || current.TESTAGRAM_COMMIT_SHA || 'cloudflare',
    },
  };
}

function valueOf(env: Env, key: string) {
  return (env as any)[key];
}

async function rateLimitKey(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const identity = authorization ? authorization : `ip:${request.headers.get('cf-connecting-ip') || 'anonymous'}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${authorization ? 'auth' : 'anon'}:${hex}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}

type SeoRoute = { title: string; description: string; canonical: string; type: string; noindex?: boolean };

function seoForPath(pathname: string): SeoRoute {
  const path = pathname.replace(/\/+$/, '') || '/';
  const base = 'https://testagram.site';
  const canonical = base + path;
  const noindex = (): SeoRoute => ({
    title: 'Testagram',
    description: 'This Testagram page is not intended for search indexing.',
    canonical,
    type: 'website',
    noindex: true,
  });

  // The browser app shell contains no private user data. Let crawlers fetch it
  // so the noindex directive below can be observed instead of relying on robots.txt.
  const privatePath = /^\/(?:auth|login|signup|messages|notifications|wallet|settings|bookmarks|history|scheduled|payouts|creator-studio|monetization|analytics|verify|verify-identity|referral|rewards|platform-inbox|interests|notification-preferences|lists|my-ads|create-ad|start-stream|ad-analytics|ad-performance|post-analytics|boost-analytics|boost-create|admin|fraud-detection|seo-audit|staff|regulator|team-chat|appeals|orders|sessions|blocked|daily-rewards|wishlist|call|tv-studio|profile\/complete)(?:\/|$)/i;
  if (privatePath.test(path)) return noindex();

  const rules: Array<[RegExp, string | null, string | null, string]> = [
    [/^\/$/, 'Testagram — Social Media, Short Videos & Global Conversations', 'Discover short videos, communities, live conversations, trending topics and creators on Testagram.', 'website'],
    [/^\/explore$/, 'Explore — Trending Content & Creators | Testagram', 'Explore trending posts, creators, communities and conversations on Testagram.', 'website'],
    [/^\/videos?$/, 'Short Videos & Reels | Testagram', 'Watch short videos, reels and creator content from around the world on Testagram.', 'website'],
    [/^\/shorts$/, 'Short Videos | Testagram', 'Discover short videos and creators on Testagram.', 'website'],
    [/^\/threads$/, 'Threads & Conversations | Testagram', 'Read and join public conversations and threads on Testagram.', 'website'],
    [/^\/communities$/, 'Communities | Testagram', 'Discover public communities and conversations on Testagram.', 'website'],
    [/^\/spaces(?:\/.*)?$/, 'Live Spaces | Testagram', 'Discover live audio conversations and public spaces on Testagram.', 'website'],
    [/^\/discover(?:\/.*)?$/, 'Discover | Testagram', 'Discover people, topics, communities and public content on Testagram.', 'website'],
    [/^\/fediverse(?:\/.*)?$/, 'Fediverse | Testagram', 'Explore public federated conversations and communities through Testagram.', 'website'],
    [/^\/help$/, 'Help & Support | Testagram', 'Find Testagram help, account, community and platform guidance.', 'website'],
    [/^\/tv$/, 'Live TV Channels & Public Streams | Testagram', 'Explore public live TV channels and community broadcasts on Testagram.', 'website'],
    [/^\/tv\/channels$/, 'Live TV Channels & Public Streams | Testagram', 'Browse public live TV channels by region and category on Testagram.', 'website'],
    [/^\/tv\/reels$/, 'TV Reels & Live Channel Clips | Testagram', 'Discover live channel playback and TV content on Testagram.', 'website'],
    [/^\/tv\/live\/(.+)$/, null, null, 'video'],
    [/^\/iptv$/, 'IPTV Player | Testagram', 'Open the Testagram IPTV player for publicly available streams.', 'website'],
    [/^\/news$/, 'News & Publisher Stories | Testagram', 'Discover news and publisher stories surfaced on Testagram.', 'website'],
    [/^\/leaderboard(?:\/.*)?$/, 'Creator Leaderboards | Testagram', 'Discover public creator and community leaderboards on Testagram.', 'website'],
    [/^\/hashtags$/, 'Popular Hashtags | Testagram', 'Discover hashtags and public conversations on Testagram.', 'website'],
    [/^\/products$/, 'Products & Creator Commerce | Testagram', 'Discover products and creator commerce on Testagram.', 'website'],
    [/^\/marketplace$/, 'Marketplace | Testagram', 'Browse the Testagram marketplace.', 'website'],
    [/^\/shop$/, 'Shop | Testagram', 'Browse products available on Testagram.', 'website'],
    [/^\/series$/, 'Creator Series | Testagram', 'Discover public creator series on Testagram.', 'website'],
    [/^\/premium$/, 'Testagram Premium | Social Features & Creator Tools', 'Explore Testagram Premium features and creator tools.', 'website'],
    [/^\/ai$/, 'AI Features | Testagram', 'Explore AI-powered features and tools on Testagram.', 'website'],
    [/^\/policy$/, 'Content Policy | Testagram', 'Read the Testagram content policy.', 'website'],
    [/^\/privacy$/, 'Privacy Policy | Testagram', 'Read the Testagram privacy policy.', 'website'],
    [/^\/terms$/, 'Terms of Service | Testagram', 'Read the Testagram terms of service.', 'website'],
    [/^\/search$/, 'Search Public Content | Testagram', 'Search public Testagram profiles, posts, communities and topics.', 'website'],
    [/^\/hashtag\/(.+)$/, null, null, 'website'],
    [/^\/trending\/(.+)$/, null, null, 'website'],
    [/^\/challenge\/(.+)$/, null, null, 'website'],
    [/^\/c\/(.+)$/, null, null, 'website'],
    [/^\/profile\/(.+)$/, null, null, 'profile'],
    [/^\/thread\/(.+)$/, null, null, 'article'],
    [/^\/post\/(.+)$/, null, null, 'article'],
    [/^\/stream\/(.+)$/, null, null, 'video'],
    [/^\/channel\/(.+)$/, null, null, 'website'],
    [/^\/news\/(.+)$/, null, null, 'article'],
    [/^\/p\/(.+)$/, null, null, 'website'],
    [/^\/seller\/(.+)$/, null, null, 'profile'],
  ];

  for (const [pattern, rawTitle, rawDescription, type] of rules) {
    const match = path.match(pattern);
    if (!match) continue;
    if (rawTitle && rawDescription) return { title: rawTitle, description: rawDescription, canonical, type };

    let value: string;
    try {
      value = decodeURIComponent(match[1]).replace(/[-_]+/g, ' ').trim();
    } catch {
      return noindex();
    }
    if (!value || /^(?:null|undefined)$/i.test(value)) return noindex();
    const label = value.replace(/\b\w/g, (letter) => letter.toUpperCase());
    if (path.startsWith('/hashtag/')) return { title: '#' + label + ' — Public Posts | Testagram', description: 'Browse public posts and conversations tagged #' + label + ' on Testagram.', canonical, type };
    if (path.startsWith('/trending/')) return { title: 'Trending ' + label + ' | Testagram', description: 'Explore public conversations and content trending around ' + label + ' on Testagram.', canonical, type };
    if (path.startsWith('/challenge/')) return { title: label + ' Challenge | Testagram', description: 'Explore this public Testagram challenge and its community.', canonical, type };
    if (path.startsWith('/c/')) return { title: label + ' Community | Testagram', description: 'Explore the public ' + label + ' community and its conversations on Testagram.', canonical, type };
    if (path.startsWith('/profile/')) return { title: '@' + value + ' on Testagram', description: 'View the public Testagram profile for @' + value + '.', canonical, type };
    if (path.startsWith('/post/')) return { title: 'Public Post | Testagram', description: 'View this public Testagram post and join the conversation.', canonical, type };
    if (path.startsWith('/thread/')) return { title: label + ' | Testagram', description: 'Read this public conversation on Testagram.', canonical, type };
    if (path.startsWith('/tv/live/')) return { title: 'Live Broadcast | Testagram', description: 'Watch this public Testagram live broadcast.', canonical, type };
    if (path.startsWith('/stream/')) return { title: 'Live Stream | Testagram', description: 'Watch this public Testagram live stream.', canonical, type };
    if (path.startsWith('/channel/')) return { title: label + ' TV Channel | Testagram', description: 'Explore this public TV channel on Testagram.', canonical, type };
    if (path.startsWith('/news/')) return { title: label + ' | Testagram News', description: 'Read this news story and related public discussion on Testagram.', canonical, type };
    if (path.startsWith('/p/')) return { title: label + ' Product | Testagram', description: 'View this public product listing on Testagram.', canonical, type };
    return { title: label + ' | Testagram', description: 'View this public Testagram page.', canonical, type };
  }

  // Unknown client-side routes and malformed slugs should not become indexed
  // soft-404s simply because the SPA host serves index.html with HTTP 200.
  return noindex();
}
async function optimizePublicHtml(response: Response, pathname: string) {
  const seo = seoForPath(pathname);
  if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) return response;
  const html = await response.text();
  const title = escapeHtml(seo.title);
  const description = escapeHtml(seo.description);
  const canonical = escapeHtml(seo.canonical);
  const robots = seo.noindex ? 'noindex, nofollow' : 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1';
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': seo.type === 'article' ? 'Article' : seo.type === 'profile' ? 'ProfilePage' : seo.type === 'video' ? 'WebPage' : seo.type === 'collection' ? 'CollectionPage' : 'WebPage',
    name: seo.title,
    description: seo.description,
    url: seo.canonical,
    isPartOf: { '@type': 'WebSite', name: 'Testagram', url: 'https://testagram.site/' }
  }).replace(/</g, '\\u003c');
  const body = html
    .replace(/<title>[\s\S]*?<\/title>/i, '<title>' + title + '</title>')
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/i, '<meta name="description" content="' + description + '" />')
    .replace(/<meta name="robots" content="[^"]*"\s*\/?>/i, '<meta name="robots" content="' + robots + '" />')
    .replace(/<meta name="googlebot" content="[^"]*"\s*\/?>/i, '<meta name="googlebot" content="' + robots + '" />')
    .replace(/<link rel="canonical" href="[^"]*"\s*\/?>/i, '<link rel="canonical" href="' + canonical + '" />')
    .replace(/<meta property="og:url" content="[^"]*"\s*\/?>/i, '<meta property="og:url" content="' + canonical + '" />')
    .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/i, '<meta property="og:title" content="' + title + '" />')
    .replace(/<meta property="og:description" content="[^"]*"\s*\/?>/i, '<meta property="og:description" content="' + description + '" />')
    .replace(/<meta name="twitter:url" content="[^"]*"\s*\/?>/i, '<meta name="twitter:url" content="' + canonical + '" />')
    .replace(/<meta name="twitter:title" content="[^"]*"\s*\/?>/i, '<meta name="twitter:title" content="' + title + '" />')
    .replace(/<meta name="twitter:description" content="[^"]*"\s*\/?>/i, '<meta name="twitter:description" content="' + description + '" />')
    .replace('</head>', '<script type="application/ld+json">' + schema + '</script></head>');
  const headers = new Headers(response.headers);
  if (seo.noindex) headers.set('X-Robots-Tag', 'noindex, nofollow');
  else headers.delete('X-Robots-Tag');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
function commonHeaders(headers = new Headers()) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  return headers;
}

async function invokeEdge(pathname: string, request: Request, env: Env) {
  // Home feed is a production-critical public contract. Keep it statically bundled
  // instead of relying on a runtime dynamic import inside the Worker isolate.
  // This avoids a class of deployed-runtime module-resolution failures that can
  // surface only as the Worker's generic 500 handler.
  if (pathname === '/api/home-feed') {
    setRuntimeEnv(env, (env as any).TESTAGRAM_COMMIT_SHA);
    return homeFeed(request);
  }

  // Keep sitemap handlers statically bundled: runtime variable imports can compile
  // successfully yet fail in the deployed Worker isolate with a generic HTTP 500.
  const sitemapHandler = STATIC_SITEMAP_ROUTES[pathname];
  if (sitemapHandler) {
    setRuntimeEnv(env, (env as any).TESTAGRAM_COMMIT_SHA);
    return sitemapHandler(request);
  }

  const modulePath = EDGE_ROUTES[pathname];
  if (!modulePath) return null;
  setRuntimeEnv(env, (env as any).TESTAGRAM_COMMIT_SHA);
  const mod = await import(modulePath);
  return mod.default(request);
}

async function invokeNode(pathname: string, request: Request, env: Env) {
  const modulePath = NODE_ROUTES[pathname];
  if (!modulePath) return null;
  setRuntimeEnv(env, (env as any).TESTAGRAM_COMMIT_SHA);

  const mod = await import(modulePath);
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();

  const req: any = {
    method: request.method,
    url: new URL(request.url).pathname + new URL(request.url).search,
    headers: Object.fromEntries(request.headers.entries()),
    body: body ?? undefined,
  };

  let status = 200;
  const responseHeaders = new Headers();

  const res: any = {
    status(code: number) {
      status = code;
      return this;
    },
    setHeader(name: string, value: string) {
      responseHeaders.set(name, String(value));
      return this;
    },
    getHeader(name: string) {
      return responseHeaders.get(name);
    },
    json(payload: unknown) {
      responseHeaders.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(payload), {
        status,
        headers: commonHeaders(responseHeaders),
      });
    },
    send(payload: unknown) {
      return new Response(payload == null ? null : String(payload), {
        status,
        headers: commonHeaders(responseHeaders),
      });
    },
    end(payload?: unknown) {
      return new Response(payload == null ? null : String(payload), {
        status,
        headers: commonHeaders(responseHeaders),
      });
    },
  };

  const result = await mod.default(req, res);
  if (result instanceof Response) return result;
  return new Response(null, { status, headers: commonHeaders(responseHeaders) });
}

function supabaseRewrite(pathname: string) {
  if (pathname === '/.well-known/webfinger') return '/functions/v1/mastodon-federation/.well-known/webfinger';
  if (pathname === '/.well-known/nodeinfo') return '/functions/v1/mastodon-federation/.well-known/nodeinfo';
  if (pathname === '/.well-known/oauth-authorization-server') return '/functions/v1/mastodon-api/.well-known/oauth-authorization-server';
  if (pathname === '/nodeinfo/2.0') return '/functions/v1/mastodon-federation/nodeinfo/2.0';
  if (pathname === '/nodeinfo/2.1') return '/functions/v1/mastodon-federation/nodeinfo/2.1';
  // ActivityPub delivery endpoints are owned by the hardened inbox verifier.
  // Do not send public inbox traffic through the read-only discovery/actor function:
  // that function historically returned 404 for /inbox when its deployed revision
  // did not contain the POST relay. Keeping the write endpoint explicit makes the
  // public contract independent of the discovery function's route table.
  if (pathname === '/inbox' || /^\/users\/[^/]+\/inbox\/?$/.test(pathname)) {
    return '/functions/v1/federation-inbox';
  }
  if (pathname === '/outbox') return '/functions/v1/mastodon-federation/outbox';

  const user = pathname.match(/^\/users\/([^/]+)(\/.*)?$/);
  if (user) return `/functions/v1/mastodon-federation/users/${user[1]}${user[2] || ''}`;

  const api = pathname.match(/^\/api\/(v1|v2)\/(.*)$/);
  if (api) return `/functions/v1/mastodon-api/api/${api[1]}/${api[2]}`;

  const oauth = pathname.match(/^\/oauth\/(.*)$/);
  if (oauth) return `/functions/v1/mastodon-api/oauth/${oauth[1]}`;

  return null;
}

async function proxySupabase(request: Request, targetPath: string) {
  const target = new URL(targetPath + new URL(request.url).search, SUPABASE_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete('host');

  const isFederationProxy =
    targetPath.startsWith('/functions/v1/mastodon-federation/') ||
    targetPath.startsWith('/functions/v1/federation-inbox/');

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
    ...(isFederationProxy
      ? {
          cache: 'no-store',
          cf: {
            cacheTtlByStatus: {
              '200-599': -1,
            },
          },
        }
      : {}),
  });

  const out = new Headers(response.headers);
  out.delete('content-length');
  out.delete('transfer-encoding');
  if (isFederationProxy) {
    out.set('Cache-Control', 'no-store');
    out.set('CDN-Cache-Control', 'no-store');
  }
  return new Response(response.body, { status: response.status, headers: out });
}


function isBlockedTvHost(hostname: string) {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata.google') return true;
  if (h.includes(':')) {
    const compact = h.replace(/^\[|\]$/g, '');
    if (compact === '::1' || compact === '::' || compact.startsWith('fc') || compact.startsWith('fd') ||
        compact.startsWith('fe8') || compact.startsWith('fe9') || compact.startsWith('fea') || compact.startsWith('feb')) return true;
    if (compact.startsWith('::ffff:')) return isBlockedTvHost(compact.slice(7));
  }
  const parts = h.split('.').map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite)) {
    const [a,b] = parts;
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
        (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return true;
  }
  return false;
}

function tvProxyUrl(target: string) {
  return 'https://testagram.site/tv-stream?url=' + encodeURIComponent(target);
}

function isTvManifest(url: URL, response: Response) {
  const type = (response.headers.get('content-type') || '').toLowerCase();
  return /mpegurl|m3u8|application\/vnd\.apple\.mpegurl/.test(type) || /\.m3u8(?:$|[?#])/i.test(url.pathname + url.search);
}

async function fetchTvUpstream(target: URL, headers: Headers) {
  let current = new URL(target);
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(current.protocol) || isBlockedTvHost(current.hostname)) throw new Error('Blocked stream redirect target');
    const response = await fetch(current.toString(), { headers, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return { response, url: current };
    const location = response.headers.get('location');
    if (!location) return { response, url: current };
    current = new URL(location, current);
  }
  throw new Error('Too many stream redirects');
}

async function handleTvStream(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { status: 204, headers: new Headers({
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'range, content-type',
    'Access-Control-Allow-Methods':'GET,OPTIONS',
    'Access-Control-Max-Age':'86400',
    'Cache-Control':'no-store',
  })});
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const requestUrl = new URL(request.url);
  const raw = requestUrl.searchParams.get('url');
  if (!raw) return new Response(JSON.stringify({ok:false,error:'Missing stream url'}), {status:400,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}});
  let target: URL;
  try { target = new URL(raw); } catch {
    return new Response(JSON.stringify({ok:false,error:'Invalid stream url'}), {status:400,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}});
  }
  if (!/^https?:$/.test(target.protocol) || isBlockedTvHost(target.hostname)) {
    return new Response(JSON.stringify({ok:false,error:'Blocked stream host'}), {status:403,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}});
  }
  const upstreamHeaders = new Headers();
  upstreamHeaders.set('Accept','*/*');
  upstreamHeaders.set('User-Agent','TestagramTV/4.0');
  const range = request.headers.get('range');
  if (range) upstreamHeaders.set('Range', range);
  try {
    const {response: upstream, url: finalUrl} = await fetchTvUpstream(target, upstreamHeaders);
    if (!upstream.ok && upstream.status !== 206) {
      return new Response(JSON.stringify({ok:false,error:'Upstream stream unavailable',status:upstream.status}), {status:502,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}});
    }
    const cors = new Headers({'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Length,Content-Range,Accept-Ranges,Content-Type,ETag','Vary':'Origin','X-Testagram-TV-Edge':'1'});
    if (isTvManifest(finalUrl, upstream)) {
      const manifest = await upstream.text();
      const rewritten = manifest.split(/\r?\n/).map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        const attrs = line.replace(/URI="([^"]+)"/gi, (_full, uri) => {
          try { return 'URI="' + tvProxyUrl(new URL(uri, finalUrl).toString()) + '"'; } catch { return _full; }
        });
        if (trimmed.startsWith('#')) return attrs;
        try { return tvProxyUrl(new URL(trimmed, finalUrl).toString()); } catch { return line; }
      }).join('\n');
      cors.set('Content-Type','application/vnd.apple.mpegurl; charset=utf-8');
      cors.set('Cache-Control','no-store, max-age=0');
      return new Response(rewritten, {status:upstream.status,headers:cors});
    }
    const out = new Headers(cors);
    for (const name of ['content-type','content-length','content-range','accept-ranges','etag','last-modified']) {
      const value = upstream.headers.get(name);
      if (value) out.set(name,value);
    }
    const cacheable = !range && upstream.status === 200;
    out.set('Cache-Control', cacheable ? 'public, max-age=8, s-maxage=8' : 'no-store');
    return new Response(upstream.body,{status:upstream.status,headers:out});
  } catch (error) {
    console.error('[testagram-tv-edge]',error);
    return new Response(JSON.stringify({ok:false,error:'TV stream edge failure'}), {status:504,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}});
  }
}

function applyPublicApiCache(response: Response, request: Request, url: URL) {
  if (request.method !== 'GET' || request.headers.has('authorization') || !response.ok) return response;
  let policy: string | null = null;
  if (url.pathname === '/api/home-feed' || url.pathname === '/api/home-discovery') {
    policy = 'public, max-age=15, s-maxage=15, stale-while-revalidate=60';
  } else if (url.pathname === '/api/news') {
    policy = 'public, max-age=30, s-maxage=30, stale-while-revalidate=120';
  } else if (url.pathname === '/api/live' && url.searchParams.get('action') === 'viewer') {
    policy = 'public, max-age=3, s-maxage=3, stale-while-revalidate=15';
  }
  if (!policy) return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', policy);
  headers.set('CDN-Cache-Control', policy);
  headers.set('Vary', 'Accept-Encoding');
  headers.set('X-Testagram-Edge-Cache', 'eligible');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);

  if (url.pathname === '/tv-stream') return handleTvStream(request);

  // Keep production liveness/readiness deterministic in the Worker runtime.
  // These two endpoints must never depend on dynamic module loading: a module
  // resolution/runtime failure would otherwise mask a healthy Worker as HTTP 500.
  if (url.pathname === '/api/health') {
    const commit = DEPLOYED_COMMIT_SHA;
    return new Response(JSON.stringify({
      ok: true,
      service: 'testagram',
      edge: 'reachable',
      commit,
    }), {
      status: 200,
      headers: commonHeaders(new Headers({
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })),
    });
  }

  if (url.pathname === '/api/ready') {
    const key = String(
      (env as any).SUPABASE_PUBLISHABLE_KEY ||
      (env as any).SUPABASE_ANON_KEY ||
      (env as any).VITE_SUPABASE_ANON_KEY ||
      'sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya'
    );
    try {
      const response = await fetch('https://ffrhglgkukgsuhxenena.supabase.co/auth/v1/settings', {
        headers: { apikey: key, Authorization: 'Bearer ' + key },
        cache: 'no-store',
      });
      return new Response(JSON.stringify({
        ok: response.ok,
        database: response.ok ? 'reachable' : 'unhealthy',
      }), {
        status: response.ok ? 200 : 503,
        headers: commonHeaders(new Headers({
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })),
      });
    } catch {
      return new Response(JSON.stringify({ ok: false, database: 'unreachable' }), {
        status: 503,
        headers: commonHeaders(new Headers({
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })),
      });
    }
  }

  const edge = await invokeEdge(url.pathname, request, env);
  if (edge) return edge;

  const node = await invokeNode(url.pathname, request, env);
  if (node) return node;

  const rewrite = supabaseRewrite(url.pathname);
  if (rewrite) return proxySupabase(request, rewrite);

  return new Response(JSON.stringify({
    ok: false,
    error: 'API_ROUTE_NOT_MIGRATED',
    path: url.pathname,
  }), {
    status: 501,
    headers: commonHeaders(new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })),
  });
}

async function handleStoryCleanup(env: Env) {
  setRuntimeEnv(env, (env as any).TESTAGRAM_COMMIT_SHA);
  const mod = await import('../api/story-cleanup');
  let status = 200;
  const headers = new Headers();
  const res: any = {
    status(code: number) { status = code; return this; },
    setHeader(name: string, value: string) { headers.set(name, String(value)); return this; },
    json(payload: unknown) {
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(payload), { status, headers: commonHeaders(headers) });
    },
    end(payload?: unknown) {
      return new Response(payload == null ? null : String(payload), { status, headers: commonHeaders(headers) });
    },
  };
  const req: any = {
    method: 'POST',
    url: '/api/story-cleanup',
    headers: { authorization: `Bearer ${String((env as any).CRON_SECRET || '')}` },
    body: undefined,
  };
  const result = await mod.default(req, res);
  return result instanceof Response ? result : new Response(null, { status, headers });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // Canonicalize the public origin: apex is the sole SEO identity.
    if (url.hostname === 'www.testagram.site') {
      return Response.redirect(`https://testagram.site${url.pathname}${url.search}`, 301);
    }

    try {
      if (url.pathname === '/sitemap.xml') {
        const sitemap = await invokeEdge('/api/sitemap-index', request, env);
        if (sitemap) {
          const headers = commonHeaders(new Headers(sitemap.headers));
          headers.set('Content-Type', 'application/xml; charset=utf-8');
          headers.set('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=21600');
          return new Response(sitemap.body, { status: sitemap.status, statusText: sitemap.statusText, headers });
        }
      }
      if (url.pathname === '/tv-stream') return await handleTvStream(request);
      if (url.pathname.startsWith('/api/')) {
        const limiter = (env as any).RATE_LIMITER;
        if (limiter?.limit && url.pathname !== '/api/health' && url.pathname !== '/api/ready' && !url.pathname.startsWith('/api/sitemap-')) {
          const { success } = await limiter.limit({ key: await rateLimitKey(request) });
          if (!success) {
            return new Response(JSON.stringify({ ok: false, error: 'Too many requests; please retry shortly.' }), {
              status: 429,
              headers: commonHeaders(new Headers({
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
                'retry-after': '60',
              })),
            });
          }
        }
        const response = await handleApi(request, env);
        return applyPublicApiCache(response, request, url);
      }

      const rewrite = supabaseRewrite(url.pathname);
      if (rewrite) return await proxySupabase(request, rewrite);

      const response = await env.ASSETS.fetch(request);
      const optimized = await optimizePublicHtml(response, url.pathname);
      const headers = commonHeaders(new Headers(optimized.headers));

      if (url.pathname.startsWith('/assets/') || /\.(js|css)$/.test(url.pathname)) {
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (/\.(xml)$/.test(url.pathname)) {
        headers.set('Cache-Control', 'public, max-age=86400');
      } else {
        headers.set('Cache-Control', 'no-store');
      }

      return new Response(optimized.body, { status: optimized.status, headers });
    } catch (error) {
      console.error('[testagram-worker]', error);
      return new Response(JSON.stringify({ ok: false, error: 'Internal hosting error' }), {
        status: 500,
        headers: commonHeaders(new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })),
      });
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env) {
    try {
      await handleStoryCleanup(env);
    } catch (error) {
      console.error('[testagram-worker] scheduled cleanup failed', error);
    }
  },
} satisfies ExportedHandler<Env>;
