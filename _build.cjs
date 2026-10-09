'use strict';

// CI forensic validation: repaired IPTV overlay source buffer.


/**
 * _build.cjs v5 — portable, self-healing Vite build wrapper.
 *
 * Every project build enters _self-heal.cjs first. That guard performs only
 * deterministic compatibility repairs, then this wrapper owns the repository
 * preload hook and starts the real Vite build. A genuine Vite failure remains
 * a genuine failure; self-healing never masks it.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const preloadPath = path.resolve(root, '_preload.cjs');
const selfHealPath = path.resolve(root, '_self-heal.cjs');

function cleanNodeOptions(v) {
  return (v || '')
    .replace(/--require\s+\S*_preload\S*/g, '')
    .replace(/--loader\s+\S+/g, '')
    .replace(/--experimental-loader\s+\S+/g, '')
    .replace(/--max_old_space_size[=\s]+\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function runSeoValidation() {
  const validatorPath = path.resolve(root, 'scripts', 'validate-seo-production.mjs');
  if (!fs.existsSync(validatorPath)) {
    process.stderr.write(`[_build] ❌ Missing SEO production validator: ${validatorPath}\n`);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env },
  });

  if (result.error) {
    process.stderr.write(`[_build] ❌ SEO production validation could not start: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`[_build] ❌ SEO production validation failed (exit ${result.status})\n`);
    process.exit(result.status || 1);
  }
}

function runSeoPrerender() {
  const scriptPath = path.resolve(root, 'scripts', 'prerender-seo.mjs');
  if (!fs.existsSync(scriptPath)) {
    process.stderr.write(`[_build] ❌ Missing SEO prerender plugin: ${scriptPath}\\n`);
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env },
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(`[_build] ❌ SEO prerender failed: ${result.error?.message || 'exit ' + result.status}\\n`);
    process.exit(result.status || 1);
  }
}

function runSelfHeal() {
  if (!fs.existsSync(selfHealPath)) {
    process.stderr.write(`[_build] ❌ Missing self-healing guard: ${selfHealPath}\n`);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [selfHealPath], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env },
  });

  if (result.error) {
    process.stderr.write(`[_build] ❌ Self-healing guard could not start: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`[_build] ❌ Self-healing guard failed (exit ${result.status})\n`);
    process.exit(result.status || 1);
  }
}

runSeoValidation();
runSelfHeal();


function patchTikVTVForTestagramAuth(vendorRoot) {
  const supabasePath = path.join(vendorRoot, 'src', 'lib', 'supabase.ts');
  const profilePath = path.join(vendorRoot, 'src', 'pages', 'Profile.tsx');
  const headerPath = path.join(vendorRoot, 'src', 'components', 'layout', 'Header.tsx');
  const feedPath = path.join(vendorRoot, 'src', 'pages', 'Feed.tsx');
  const indexHtmlPath = path.join(vendorRoot, 'index.html');
  const socialServicePath = path.join(vendorRoot, 'src', 'lib', 'testagramSocial.ts');
  const reactionHookPath = path.join(vendorRoot, 'src', 'hooks', 'useReactions.ts');
  const commentsHookPath = path.join(vendorRoot, 'src', 'hooks', 'useComments.ts');
  const favoritesHookPath = path.join(vendorRoot, 'src', 'hooks', 'useFavorites.ts');
  const watchHistoryHookPath = path.join(vendorRoot, 'src', 'hooks', 'useWatchHistory.ts');
  const trendingHookPath = path.join(vendorRoot, 'src', 'hooks', 'useTrending.ts');
  const reactionBarPath = path.join(vendorRoot, 'src', 'components', 'features', 'ReactionBar.tsx');
  const videoPlayerPath = path.join(vendorRoot, 'src', 'components', 'features', 'VideoPlayer.tsx');
  const channelDetailPath = path.join(vendorRoot, 'src', 'pages', 'ChannelDetail.tsx');
  const channelCardPath = path.join(vendorRoot, 'src', 'components', 'features', 'ChannelCard.tsx');
  const categoryTabsPath = path.join(vendorRoot, 'src', 'components', 'features', 'CategoryTabs.tsx');
  const indexCssPath = path.join(vendorRoot, 'src', 'index.css');
  const iptvApiPath = path.join(vendorRoot, 'src', 'lib', 'iptvApi.ts');
  const channelsHookPath = path.join(vendorRoot, 'src', 'hooks', 'useChannels.ts');
  const xcloneSupabasePath = path.join(root, 'src', 'lib', 'supabase.ts');

  const xcloneSupabase = fs.readFileSync(xcloneSupabasePath, 'utf8');
  const readXcloneConstant = (name) => {
    const line = xcloneSupabase.split('\n').find((value) => value.includes(`const ${name}`));
    const match = line?.match(/['"]([^'"]+)['"]/);
    return match?.[1];
  };
  const supabaseUrl = readXcloneConstant('PRIMARY_SUPABASE_URL');
  const supabasePublishableKey = readXcloneConstant('PRIMARY_SUPABASE_PUBLISHABLE_KEY');
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('[TikVTV/Testagram Auth] Could not derive Xclone primary Supabase configuration');
  }

  const supabaseSource = `import { createClient } from '@supabase/supabase-js';

const supabaseUrl = ${JSON.stringify(supabaseUrl)};
const supabasePublishableKey = ${JSON.stringify(supabasePublishableKey)};

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'testagram-auth',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});
`;

  if (!fs.existsSync(supabasePath) || !fs.existsSync(profilePath) || !fs.existsSync(headerPath) || !fs.existsSync(feedPath) || !fs.existsSync(indexHtmlPath)) {
    throw new Error('[TikVTV/Testagram Auth] Expected upstream auth/branding files are missing');
  }

  const original = new Map([
    [supabasePath, fs.readFileSync(supabasePath, 'utf8')],
    [profilePath, fs.readFileSync(profilePath, 'utf8')],
    [headerPath, fs.readFileSync(headerPath, 'utf8')],
    [feedPath, fs.readFileSync(feedPath, 'utf8')],
    [indexHtmlPath, fs.readFileSync(indexHtmlPath, 'utf8')],
    [reactionHookPath, fs.readFileSync(reactionHookPath, 'utf8')],
    [commentsHookPath, fs.readFileSync(commentsHookPath, 'utf8')],
    [favoritesHookPath, fs.readFileSync(favoritesHookPath, 'utf8')],
    [watchHistoryHookPath, fs.readFileSync(watchHistoryHookPath, 'utf8')],
    [trendingHookPath, fs.readFileSync(trendingHookPath, 'utf8')],
    [reactionBarPath, fs.readFileSync(reactionBarPath, 'utf8')],
    [videoPlayerPath, fs.readFileSync(videoPlayerPath, 'utf8')],
    [channelDetailPath, fs.readFileSync(channelDetailPath, 'utf8')],
    [channelCardPath, fs.readFileSync(channelCardPath, 'utf8')],
    [categoryTabsPath, fs.readFileSync(categoryTabsPath, 'utf8')],
    [indexCssPath, fs.readFileSync(indexCssPath, 'utf8')],
    [iptvApiPath, fs.readFileSync(iptvApiPath, 'utf8')],
    [channelsHookPath, fs.readFileSync(channelsHookPath, 'utf8')],
  ]);

  let profile = original.get(profilePath);
  profile = profile
    .replace("import AuthModal from '@/components/features/AuthModal';", '')
    .replace("  const [showAuth,   setShowAuth]   = useState(false);", '')
    .replace("        onClick={() => setShowAuth(true)}", "        onClick={() => { window.top?.location.assign('/auth?returnTo=/iptv-app/entry.html'); }}")
    .replace("      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}", '');



  if (profile === original.get(profilePath) || /AuthModal|showAuth|setShowAuth/.test(profile)) {
    throw new Error('[TikVTV/Testagram Auth] Failed to remove the upstream profile auth modal');
  }

  let header = original.get(headerPath)
    .replace("import AuthModal from '@/components/features/AuthModal';\n", '')
    .replace("  const [showAuth,   setShowAuth]   = useState(false);\n", '')
    .replace("            Tik<span className=\"text-primary\">V</span>TV", "            Testagram")
    .replace("                <LogIn className=\"w-3.5 h-3.5\" />\n                {t('login')}", "                <LogIn className=\"w-3.5 h-3.5\" />\n                {t('login')}")
    .replace("onClick={() => setShowAuth(true)}", "onClick={() => { window.top?.location.assign('/auth?returnTo=/iptv-app/entry.html'); }}")
    .replace("\n      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}\n", "\n");

  let feed = original.get(feedPath)
    .replace("import AuthModal from '@/components/features/AuthModal';\n", '')
    .replace("  const [showAuth,    setShowAuth]   = useState(false);\n", '')
    .replace("onAuthRequired={() => setShowAuth(true)}", "onAuthRequired={() => { window.top?.location.assign('/auth?returnTo=/iptv-app/entry.html'); }}")
    .replace("\n      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}\n", "\n");

  let indexHtml = original.get(indexHtmlPath)
    .replace(/TikVTV/g, 'Testagram')
    .replace(/TikTok-style/g, 'Testagram-style')
    // Mirror XClone's saved next-themes preference before the IPTV UI paints.
    .replace('</head>', `<script>
      (() => {
        const applyTheme = () => {
          let preference = 'system';
          try { preference = localStorage.getItem('theme') || 'system'; } catch {}
          const dark = preference === 'dark' ||
            (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
        };
        applyTheme();
        try {
          window.addEventListener('storage', event => { if (event.key === 'theme') applyTheme(); });
          window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
        } catch {}
      })();
    </script>\\n</head>`);

  if (/TikVTV|AuthModal|showAuth|setShowAuth/.test(header)) {
    throw new Error('[TikVTV/Testagram Auth] Failed to remove TikVTV header branding or auth modal');
  }
  if (/AuthModal|showAuth|setShowAuth/.test(feed)) {
    throw new Error('[TikVTV/Testagram Auth] Failed to remove TikVTV feed auth modal');
  }

  fs.writeFileSync(supabasePath, supabaseSource, 'utf8');
  fs.writeFileSync(socialServicePath, "import { createClient } from '@supabase/supabase-js';\nimport { supabase } from '@/lib/supabase';\n\nconst SECONDARY_FUNCTION_URL = 'https://aepbqfrmheihfsauzcby.supabase.co/functions/v1/iptv-social';\nconst SECONDARY_PUBLISHABLE_KEY = 'sb_publishable_f331BL1gsNy-otXRmQPtrw_SG8tCWLn';\n\nexport const secondaryRealtime = createClient(\n  'https://aepbqfrmheihfsauzcby.supabase.co',\n  SECONDARY_PUBLISHABLE_KEY,\n  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },\n);\n\nexport async function iptvSocial<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {\n  const { data } = await supabase.auth.getSession();\n  const headers: Record<string, string> = {\n    apikey: SECONDARY_PUBLISHABLE_KEY,\n    'Content-Type': 'application/json',\n  };\n  if (data.session?.access_token) headers.Authorization = 'Bearer ' + data.session.access_token;\n  const response = await fetch(SECONDARY_FUNCTION_URL, {\n    method: 'POST',\n    headers,\n    body: JSON.stringify({ action, ...payload }),\n  });\n  const body = await response.json().catch(() => ({}));\n  if (!response.ok) throw new Error(body?.error || 'IPTV social request failed');\n  return body as T;\n}\n", 'utf8');
  fs.writeFileSync(reactionHookPath, "import { useState, useCallback, useEffect } from 'react';\nimport { iptvSocial } from '@/lib/testagramSocial';\n\nexport function useReactions(channelId: string, userId?: string) {\n  const [liked, setLiked] = useState(false);\n  const [likeCount, setLikeCount] = useState(0);\n  const [loading, setLoading] = useState(false);\n\n  useEffect(() => {\n    let mounted = true;\n    iptvSocial<{liked:boolean;likeCount:number}>('reactions_state', { channelId })\n      .then(r => { if (mounted) { setLiked(!!r.liked); setLikeCount(r.likeCount || 0); } })\n      .catch(() => {});\n    return () => { mounted = false; };\n  }, [channelId, userId]);\n\n  const toggleLike = useCallback(async (): Promise<boolean> => {\n    if (!userId || loading) return false;\n    setLoading(true);\n    try {\n      const r = await iptvSocial<{liked:boolean}>('reaction_toggle', { channelId });\n      setLiked(!!r.liked);\n      setLikeCount(n => Math.max(0, n + (r.liked ? 1 : -1)));\n      return true;\n    } catch { return false; }\n    finally { setLoading(false); }\n  }, [channelId, userId, loading]);\n\n  return { liked, likeCount, loading, toggleLike };\n}\n", 'utf8');
  fs.writeFileSync(commentsHookPath, "import { useState, useCallback, useEffect } from 'react';\nimport { iptvSocial, secondaryRealtime } from '@/lib/testagramSocial';\nimport type { Comment } from '@/types';\nimport { toast } from 'sonner';\n\nfunction mapComment(c: any): Comment {\n  return { ...c, user_profiles: { username: c.username || 'user' } };\n}\n\nexport function useComments(channelId: string) {\n  const [comments, setComments] = useState<Comment[]>([]);\n  const [loading, setLoading] = useState(false);\n  const [count, setCount] = useState(0);\n\n  const fetchComments = useCallback(async () => {\n    if (!channelId) return;\n    setLoading(true);\n    try {\n      const r = await iptvSocial<{comments:any[]}>('comments_list', { channelId });\n      const active = (r.comments || []).filter(c => new Date(c.expires_at).getTime() > Date.now());\n      setComments(active.map(mapComment));\n      setCount(active.length);\n    } catch (e) { console.error('[Comments] Fetch error:', e); }\n    finally { setLoading(false); }\n  }, [channelId]);\n\n  const fetchCount = useCallback(async () => {\n    try {\n      const r = await iptvSocial<{count:number}>('comments_count', { channelId });\n      setCount(r.count || 0);\n    } catch {}\n  }, [channelId]);\n\n  const addComment = useCallback(async (content: string, userId: string) => {\n    const trimmed = content.trim().slice(0, 280);\n    if (!trimmed || !userId) return;\n    try {\n      const r = await iptvSocial<{comment:any}>('comment_add', { channelId, content: trimmed });\n      if (r.comment) {\n        const mapped = mapComment(r.comment);\n        setComments(prev => [mapped, ...prev.filter(c => c.id !== mapped.id)].slice(0, 100));\n        setCount(n => n + 1);\n      }\n    } catch (e) { toast.error('Failed to post comment'); console.error('[Comments] Insert error:', e); }\n  }, [channelId]);\n\n  const deleteComment = useCallback(async (commentId: string) => {\n    try {\n      await iptvSocial('comment_delete', { id: commentId });\n      setComments(prev => prev.filter(c => c.id !== commentId));\n      setCount(n => Math.max(0, n - 1));\n    } catch {}\n  }, []);\n\n  useEffect(() => {\n    if (!channelId) return;\n    const channel = secondaryRealtime.channel('iptv:channel:' + channelId + ':comments');\n    channel.on('broadcast', { event: 'comment_created' }, payload => {\n      const c = payload.payload;\n      if (!c?.id || new Date(c.expires_at).getTime() <= Date.now()) return;\n      const mapped = mapComment(c);\n      setComments(prev => [mapped, ...prev.filter(x => x.id !== mapped.id)].slice(0, 100));\n      setCount(n => n + 1);\n    });\n    channel.on('broadcast', { event: 'comment_deleted' }, payload => {\n      const id = payload.payload?.id;\n      if (!id) return;\n      setComments(prev => prev.filter(c => c.id !== id));\n      setCount(n => Math.max(0, n - 1));\n    });\n    channel.subscribe();\n    return () => { secondaryRealtime.removeChannel(channel); };\n  }, [channelId]);\n\n  return { comments, loading, count, fetchComments, fetchCount, addComment, deleteComment };\n}\n", 'utf8');
  fs.writeFileSync(favoritesHookPath, "import { useState, useEffect, useCallback } from 'react';\nimport { iptvSocial } from '@/lib/testagramSocial';\nimport type { IPTVChannel, Favorite } from '@/types';\nimport { toast } from 'sonner';\n\nexport function useFavorites(userId?: string) {\n  const [favorites, setFavorites] = useState<Favorite[]>([]);\n  const [favIds, setFavIds] = useState<Set<string>>(new Set());\n  const [loading, setLoading] = useState(false);\n\n  useEffect(() => {\n    if (!userId) { setFavorites([]); setFavIds(new Set()); return; }\n    setLoading(true);\n    iptvSocial<{bookmarks:any[]}>('bookmark_list')\n      .then(r => {\n        const items = (r.bookmarks || []).map((f:any) => ({\n          id: f.channel_id + ':' + f.created_at,\n          user_id: userId,\n          channel_id: f.channel_id,\n          channel_data: f.channel_data,\n          created_at: f.created_at,\n        })) as Favorite[];\n        setFavorites(items.filter(x => !!x.channel_data));\n        setFavIds(new Set(items.map(x => x.channel_id)));\n      })\n      .catch(() => {})\n      .finally(() => setLoading(false));\n  }, [userId]);\n\n  const isFavorite = useCallback((channelId: string) => favIds.has(channelId), [favIds]);\n\n  const toggleFavorite = useCallback(async (channel: IPTVChannel) => {\n    if (!userId) return;\n    try {\n      const r = await iptvSocial<{bookmarked:boolean}>('bookmark_toggle', { channelId: channel.id, channel });\n      if (r.bookmarked) {\n        setFavorites(prev => [{ id: channel.id + ':' + Date.now(), user_id: userId, channel_id: channel.id, channel_data: channel, created_at: new Date().toISOString() }, ...prev]);\n        setFavIds(prev => new Set([...prev, channel.id]));\n        toast.success('Saved to favorites ✨');\n      } else {\n        setFavorites(prev => prev.filter(f => f.channel_id !== channel.id));\n        setFavIds(prev => { const s = new Set(prev); s.delete(channel.id); return s; });\n        toast.success('Removed from favorites');\n      }\n    } catch { toast.error('Could not update saved channel'); }\n  }, [userId]);\n  return { favorites, loading, isFavorite, toggleFavorite };\n}\n", 'utf8');
  fs.writeFileSync(watchHistoryHookPath, "import { useState, useEffect, useCallback } from 'react';\nimport type { WatchHistoryItem, IPTVChannel } from '@/types';\nimport { iptvSocial } from '@/lib/testagramSocial';\n\nexport function useWatchHistory() {\n  const [history, setHistory] = useState<WatchHistoryItem[]>([]);\n  const load = useCallback(async () => {\n    try {\n      const r = await iptvSocial<{history:any[]}>('history_list');\n      setHistory((r.history || []).map((h:any) => ({\n        channelId:h.channel_id,name:h.channel_name,logo:h.channel_logo,country:h.country,\n        countryCode:h.country_code,categories:Array.isArray(h.categories)?h.categories:[],watchedAt:h.watched_at,\n      })));\n    } catch {}\n  }, []);\n  useEffect(() => { load(); }, [load]);\n  const addToHistory = useCallback((channel: IPTVChannel) => {\n    setHistory(prev => [{channelId:channel.id,name:channel.name,logo:channel.logo,country:channel.country,countryCode:channel.countryCode,categories:channel.categories,watchedAt:new Date().toISOString()}, ...prev.filter(h => h.channelId !== channel.id)]);\n    void iptvSocial('history_upsert', { channel }).catch(() => {});\n  }, []);\n  const removeFromHistory = useCallback((channelId:string) => {\n    setHistory(prev => prev.filter(h => h.channelId !== channelId));\n    void iptvSocial('history_delete', { channelId }).catch(() => {});\n  }, []);\n  const clearHistory = useCallback(() => {\n    setHistory([]);\n    void iptvSocial('history_clear').catch(() => {});\n  }, []);\n  const getSuggestedCategories = useCallback((topN=3) => {\n    const counts=new Map<string,number>();\n    for(const item of history) for(const cat of item.categories) counts.set(cat,(counts.get(cat)||0)+1);\n    return Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,topN).map(([cat])=>cat);\n  },[history]);\n  return { history, addToHistory, removeFromHistory, clearHistory, getSuggestedCategories };\n}\n", 'utf8');
  fs.writeFileSync(trendingHookPath, "import { useState, useEffect } from 'react';\nimport { iptvSocial } from '@/lib/testagramSocial';\nimport { fetchAllChannels, getChannelById } from '@/lib/iptvApi';\nimport type { TrendingChannel } from '@/types';\n\nexport function useTrending(limit=30) {\n  const [trending,setTrending]=useState<TrendingChannel[]>([]);\n  const [loading,setLoading]=useState(true);\n  useEffect(()=>{let mounted=true;(async()=>{await fetchAllChannels();try{const r=await iptvSocial<{scores:[string,number][]}>('trending');if(!mounted)return;setTrending((r.scores||[]).slice(0,limit).map(([channel_id,score])=>({channel_id,score,channel:getChannelById(channel_id)})).filter(x=>!!x.channel) as TrendingChannel[]);}catch{}finally{if(mounted)setLoading(false);}})();return()=>{mounted=false}},[limit]);\n  return {trending,loading};\n}\n", 'utf8');
  fs.writeFileSync(reactionBarPath, fs.readFileSync(reactionBarPath, 'utf8').replace("import { supabase } from '@/lib/supabase';", "import { iptvSocial } from '@/lib/testagramSocial';").replace("const { error } = await supabase.from('reports').insert({\n      channel_id: channel.id,\n      user_id: user?.id || null,\n      reason,\n    });\n    setReporting(false);", "let error: unknown = null;\n    try { await iptvSocial('report', { channelId: channel.id, reason }); } catch (e) { error = e; }\n    setReporting(false);"), 'utf8');
  fs.writeFileSync(profilePath, profile, 'utf8');
  fs.writeFileSync(headerPath, header, 'utf8');
  // Premium Testagram IPTV vertical-feed treatment: immersive viewport, overlay navigation,
  // stronger safe-area handling, and mobile-first interaction without changing channel data.
  feed = feed
    .replace('const PRELOAD_RADIUS = 4;', 'const PRELOAD_RADIUS = 1;')
    .replace('className="h-screen bg-black flex flex-col overflow-hidden"', 'className="h-[100dvh] bg-black relative overflow-hidden"')
    .replace('<Header liveCount={liveCount} totalChannels={total} />', '<div className="absolute inset-x-0 top-0 z-40 pointer-events-none"><div className="pointer-events-auto"><Header liveCount={liveCount} totalChannels={total} /></div></div>')
    .replace('className="flex-1 overflow-y-scroll"', 'className="absolute inset-0 overflow-y-scroll snap-y snap-mandatory overscroll-contain"')
    .replace("style={{ scrollSnapType: 'y mandatory', overscrollBehavior: 'contain' }}", "style={{ scrollSnapType: 'y mandatory', overscrollBehaviorY: 'contain', WebkitOverflowScrolling: 'touch' }}")
    .replace('        <CategoryTabs activeCategory={category} onCategoryChange={handleCategoryChange} />', '        <div className="absolute top-[58px] left-0 right-0 z-30 pointer-events-none"><div className="pointer-events-auto"><CategoryTabs activeCategory={category} onCategoryChange={handleCategoryChange} /></div></div>')
    .replace('          <div className="bg-black/60 backdrop-blur px-4 py-2 border-b border-white/5 flex items-center gap-2">', '          <div className="absolute top-[58px] left-0 right-0 z-30 bg-black/50 backdrop-blur px-4 py-2 border-b border-white/5 flex items-center gap-2">');
  feed = feed
    .replace('shouldLoad={Math.abs(index - activeIndex) <= PRELOAD_RADIUS}', 'shouldLoad={index >= Math.floor(activeIndex / 4) * 4 && index < Math.floor(activeIndex / 4) * 4 + 4 || (activeIndex % 4 >= 2 && index >= (Math.floor(activeIndex / 4) + 1) * 4 && index < (Math.floor(activeIndex / 4) + 2) * 4)}')
    .replace('if (idx >= liveChannels.length - 5 && hasMore) loadMore();', 'if ((idx + 1) % 4 === 3 && hasMore) loadMore();');
  fs.writeFileSync(feedPath, feed, 'utf8');

  const card = fs.readFileSync(channelCardPath, 'utf8')
    .replace('className="relative w-full bg-black"', 'className="relative w-full h-[100dvh] bg-black snap-start snap-always overflow-hidden"')
    .replace("style={{ height: '100dvh', scrollSnapAlign: 'start' }}", "")
    .replace('className="absolute bottom-0 left-0 right-0 px-4 pb-6 flex items-end justify-between gap-4"', 'className="absolute bottom-0 left-0 right-0 px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] flex items-end justify-between gap-4 z-20"');
  fs.writeFileSync(channelCardPath, card, 'utf8');

  let tabs = fs.readFileSync(categoryTabsPath, 'utf8')
    .replace('className="relative bg-black/80 backdrop-blur-sm border-b border-white/5"', 'className="relative bg-black/25 backdrop-blur-md border-b border-white/5 overflow-hidden"')
    .replace("'min-h-[36px] min-w-[44px]'", "'min-h-[34px] min-w-[44px]'");
  fs.writeFileSync(categoryTabsPath, tabs, 'utf8');

  let css = fs.readFileSync(indexCssPath, 'utf8');
  css += `
/* XClone design-system bridge: use the same semantic tokens as src/index.css. */
:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 5%;
  --card: 0 0% 100%;
  --card-foreground: 0 0% 5%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 5%;
  --primary: 142 76% 32%;
  --primary-foreground: 0 0% 100%;
  --secondary: 0 0% 95%;
  --secondary-foreground: 0 0% 9%;
  --muted: 0 0% 95%;
  --muted-foreground: 0 0% 42%;
  --accent: 142 76% 32%;
  --accent-foreground: 0 0% 100%;
  --border: 0 0% 88%;
  --input: 0 0% 88%;
  --ring: 142 76% 32%;
  --iptv-primary: hsl(var(--primary));
  --iptv-surface: hsl(var(--background));
  --iptv-surface-raised: hsl(var(--card));
  --iptv-border: hsl(var(--border));
}
html.dark, .dark {
  --background: 0 0% 0%;
  --foreground: 0 0% 98%;
  --card: 0 0% 7%;
  --card-foreground: 0 0% 98%;
  --popover: 0 0% 7%;
  --popover-foreground: 0 0% 98%;
  --primary: 142 76% 36%;
  --primary-foreground: 0 0% 100%;
  --secondary: 0 0% 14%;
  --secondary-foreground: 0 0% 98%;
  --muted: 0 0% 14%;
  --muted-foreground: 0 0% 65%;
  --accent: 142 76% 36%;
  --accent-foreground: 0 0% 100%;
  --border: 0 0% 15%;
  --input: 0 0% 15%;
  --ring: 142 76% 36%;
  --iptv-primary: hsl(var(--primary));
  --iptv-surface: hsl(var(--background));
  --iptv-surface-raised: hsl(var(--card));
  --iptv-border: hsl(var(--border));
}
html, body, #root { background: hsl(var(--background)); color: hsl(var(--foreground)); color-scheme: light; }
html.dark { color-scheme: dark; }
button, [role="button"] { -webkit-tap-highlight-color: transparent; }
button:focus-visible, [role="button"]:focus-visible, a:focus-visible {
  outline: 2px solid hsl(var(--ring)); outline-offset: 2px;
}
.iptv-vertical-feed { height: 100dvh; width: 100%; overflow: hidden; background: hsl(var(--background)); color: hsl(var(--foreground)); }
.iptv-vertical-feed button[class*="bg-"], .iptv-vertical-feed [role="button"][class*="bg-"] {
  transition: background-color 140ms ease, border-color 140ms ease, transform 140ms ease;
}
.iptv-vertical-feed [aria-pressed="true"], .iptv-vertical-feed [data-active="true"] {
  border-color: hsl(var(--primary));
}
.iptv-vertical-feed .text-primary, .iptv-vertical-feed .text-green-500,
.iptv-vertical-feed .text-green-400 { color: hsl(var(--primary)) !important; }
.iptv-vertical-feed .bg-primary, .iptv-vertical-feed .bg-green-500,
.iptv-vertical-feed .bg-green-600 { background-color: hsl(var(--primary)) !important; }
.iptv-vertical-feed .border-primary, .iptv-vertical-feed .border-green-500 {
  border-color: hsl(var(--primary)) !important;
}
.iptv-vertical-feed [class~="bg-black/90"], .iptv-vertical-feed [class~="bg-black/95"] { background-color: hsl(var(--background) / .94) !important; }
.iptv-vertical-feed [class~="border-white/10"], .iptv-vertical-feed [class~="border-white/15"] { border-color: hsl(var(--border) / .9) !important; }
@media (orientation: landscape) and (max-height: 600px) {
  .iptv-vertical-feed .channel-info { max-width: 58vw; }
}
@media (prefers-reduced-motion: reduce) {
  .iptv-vertical-feed *, .iptv-vertical-feed *::before, .iptv-vertical-feed *::after {
    animation-duration: 0.01ms !important; transition-duration: 0.01ms !important;
  }
}
`;
  fs.writeFileSync(indexCssPath, css, 'utf8');

  fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');

  // Keep first paint independent of slow third-party M3U providers.
  let iptvApi = original.get(iptvApiPath);
  const originalPrimaryFetch = `const [chanRes, streamRes, extraChannels] = await Promise.all([
      fetch(CHANNELS_API),
      fetch(STREAMS_API),
      fetchExtraSources(),
    ]);`;
  const fastPrimaryFetch = `const [chanRes, streamRes] = await Promise.all([
      fetch(CHANNELS_API, { signal: AbortSignal.timeout(12000) }),
      fetch(STREAMS_API, { signal: AbortSignal.timeout(12000) }),
    ]);
    const extraChannels: IPTVChannel[] = [];`;
  if (!iptvApi.includes(originalPrimaryFetch)) throw new Error('[IPTV performance] primary fetch anchor changed upstream');
  iptvApi = iptvApi.replace(originalPrimaryFetch, fastPrimaryFetch);

  const helperEnd = `  return all;
}

export async function fetchAllChannels(): Promise<IPTVChannel[]> {`;
  const helperEnhanced = `  return all;
}

function mergeExtraChannels(extraChannels: IPTVChannel[]) {
  const current = memCache || [];
  const ids = new Set(current.map(ch => ch.id));
  const urls = new Set(current.map(ch => ch.streamUrl));
  const extra = extraChannels.filter(ch => !ids.has(ch.id) && !urls.has(ch.streamUrl) && ch.streamUrl && ch.name && ch.name.length > 1);
  if (!extra.length) return;
  memCache = [...current, ...extra];
  console.log('[IPTV] Background catalog merged: +' + extra.length + ' channels');
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ channels: memCache, timestamp: Date.now() })); } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('iptv:channels-updated', { detail: memCache }));
}

export async function fetchAllChannels(): Promise<IPTVChannel[]> {`;
  if (!iptvApi.includes(helperEnd)) throw new Error('[IPTV performance] M3U helper boundary changed upstream');
  iptvApi = iptvApi.replace(helperEnd, helperEnhanced);

  const cachedReturn = `        memCache = data.channels;
        return memCache;`;
  const cachedFastReturn = `        memCache = data.channels;
        void fetchExtraSources().then(mergeExtraChannels).catch(error => console.warn('[IPTV] Background playlist enrichment failed:', error));
        return memCache;`;
  if (!iptvApi.includes(cachedReturn)) throw new Error('[IPTV performance] cache-hit anchor changed upstream');
  iptvApi = iptvApi.replace(cachedReturn, cachedFastReturn);

  const primaryReturn = `    memCache = all;
    return memCache;`;
  const primaryFastReturn = `    memCache = all;
    void fetchExtraSources().then(mergeExtraChannels).catch(error => console.warn('[IPTV] Background playlist enrichment failed:', error));
    return memCache;`;
  if (!iptvApi.includes(primaryReturn)) throw new Error('[IPTV performance] primary return anchor changed upstream');
  iptvApi = iptvApi.replace(primaryReturn, primaryFastReturn);
  fs.writeFileSync(iptvApiPath, iptvApi, 'utf8');

  // Refresh visible channels when the background catalog is ready without resetting feed position.
  let channelsHook = original.get(channelsHookPath);
  const hookCleanup = "    return () => { mounted = false; };";
  const hookEnhancedCleanup = `    const onChannelsUpdated = (event: Event) => {
      const all = (event as CustomEvent<IPTVChannel[]>).detail;
      if (!mounted || !Array.isArray(all)) return;
      allChannelsRef.current = all;
      const refreshed = Array.from({ length: Math.max(1, pageRef.current) }, (_, i) =>
        getChannelPage(all, category, i + 1, countryCode).items
      ).flat();
      setChannels(refreshed);
      const page = getChannelPage(all, category, pageRef.current, countryCode);
      setHasMore(page.hasMore);
      setTotal(page.total);
    };
    window.addEventListener('iptv:channels-updated', onChannelsUpdated);
    return () => { mounted = false; window.removeEventListener('iptv:channels-updated', onChannelsUpdated); };`;
  if (!channelsHook.includes(hookCleanup)) throw new Error('[IPTV performance] useChannels cleanup anchor changed upstream');
  channelsHook = channelsHook.replace(hookCleanup, hookEnhancedCleanup);
  fs.writeFileSync(channelsHookPath, channelsHook, 'utf8');

  let videoPlayer = fs.readFileSync(videoPlayerPath, 'utf8');
  const videoPlayerReplacements = [["import { Volume2, VolumeX, WifiOff, RefreshCw, PictureInPicture2, Settings2, Check } from 'lucide-react';","import { Volume2, VolumeX, WifiOff, RefreshCw, PictureInPicture2, Settings2, Check, Maximize2, Minimize2 } from 'lucide-react';"],["const [showQuality, setShowQuality] = useState(false);","const [showQuality, setShowQuality] = useState(false);\n    const [fullscreen, setFullscreen] = useState(false);\n    const stallRecoveryRef = useRef(0);"],["    const pipSupported = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document;","    const pipSupported = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document;\n\n    const toggleFullscreen = async () => {\n      const video = videoRef.current; if (!video) return;\n      try { if (document.fullscreenElement) { await document.exitFullscreen(); setFullscreen(false); return; } await video.requestFullscreen(); setFullscreen(true); try { await (screen.orientation as any)?.lock?.('landscape'); } catch {} } catch {}\n    };"],["lowLatencyMode:         true,\n              maxBufferLength:        12,\n              maxMaxBufferLength:     24,\n              maxBufferSize:          24 * 1000 * 1000,","lowLatencyMode:         false,\n              startFragPrefetch:      true,\n              initialLiveManifestSize: 4,\n              maxBufferLength:        isActive ? 24 : 5,\n              maxMaxBufferLength:     isActive ? 30 : 8,\n              maxBufferSize:          isActive ? 32 * 1000 * 1000 : 8 * 1000 * 1000,\n              backBufferLength:       isActive ? 12 : 0,\n              frontBufferFlushThreshold: 120,\n              maxBufferHole:          0.5,\n              liveSyncDurationCount:  5,\n              liveMaxLatencyDurationCount: 10,\n              liveSyncOnStallIncrease: 1,\n              maxLiveSyncPlaybackRate: 1.15,\n              highBufferWatchdogPeriod: 2,\n              abrBandWidthFactor: 0.7,\n              abrBandWidthUpFactor: 0.5,\n              capLevelToPlayerSize: true,"],["manifestLoadingMaxRetry: 1,\n              levelLoadingMaxRetry:    1,\n              fragLoadingMaxRetry:     1,","manifestLoadingMaxRetry: 3,\n              manifestLoadingRetryDelay: 1000,\n              levelLoadingMaxRetry: 3,\n              levelLoadingRetryDelay: 1000,\n              fragLoadingMaxRetry: 6,\n              fragLoadingRetryDelay: 800,"],["            hls.on(Hls.Events.ERROR, (_: unknown, d: { fatal: boolean; type: string }) => {\n              if (d.fatal) {\n                if (retryCount.current < 1) {\n                  retryCount.current++;\n                  hls.recoverMediaError();\n                } else {\n                  markError();\n                }\n              }\n            });","            hls.on(Hls.Events.ERROR, (_: unknown, d: { fatal: boolean; type: string }) => {\n              if (!d.fatal) return;\n              const now = Date.now();\n              if (now - stallRecoveryRef.current < 3000) return;\n              stallRecoveryRef.current = now;\n              if (retryCount.current < 3) { retryCount.current++; hls.startLoad(-1); hls.recoverMediaError(); } else markError();\n            });"],["            {/* PiP button */}\n            {pipSupported && (","            {/* Landscape/fullscreen button */}\n            <button onClick={e => { e.stopPropagation(); void toggleFullscreen(); }} aria-label={fullscreen ? 'Exit fullscreen' : 'Landscape fullscreen'} className=\"w-8 h-8 rounded-full flex items-center justify-center bg-black/50 hover:bg-black/70 backdrop-blur-sm\">\n              {fullscreen ? <Minimize2 className=\"w-4 h-4 text-white\" /> : <Maximize2 className=\"w-4 h-4 text-white\" />}\n            </button>\n\n            {/* PiP button */}\n            {pipSupported && ("],["    }, [src, shouldLoad, isActive, onError, onReady]);","    }, [src, shouldLoad, onError, onReady]);"],["              lowLatencyMode:           true,\n              maxBufferLength:        12,\n              maxMaxBufferLength:     24,\n              maxBufferSize:          24 * 1000 * 1000,","              lowLatencyMode:           false,\n              startFragPrefetch:          true,\n              initialLiveManifestSize:    4,\n              maxBufferLength:            isActive ? 24 : 5,\n              maxMaxBufferLength:         isActive ? 30 : 8,\n              maxBufferSize:              isActive ? 32 * 1000 * 1000 : 8 * 1000 * 1000,\n              backBufferLength:           isActive ? 12 : 0,\n              frontBufferFlushThreshold: 120,\n              liveSyncDurationCount:      5,\n              liveMaxLatencyDurationCount: 10,\n              maxLiveSyncPlaybackRate:    1.15,\n              highBufferWatchdogPeriod:   2,\n              abrBandWidthFactor:         0.7,\n              abrBandWidthUpFactor:        0.5,\n              capLevelToPlayerSize:       true,"],["              manifestLoadingMaxRetry: 1,\n              levelLoadingMaxRetry:    1,\n              fragLoadingMaxRetry:     1,","manifestLoadingMaxRetry: 3,\n              manifestLoadingRetryDelay: 1000,\n              levelLoadingMaxRetry: 3,\n              levelLoadingRetryDelay: 1000,\n              fragLoadingMaxRetry: 6,\n              fragLoadingRetryDelay: 800,"],["            hls.on(Hls.Events.ERROR, (_: unknown, d: { fatal: boolean; type: string }) => {\n              if (d.fatal) {\n                if (retryCount.current < 1) {\n                  retryCount.current++;\n                  hls.recoverMediaError();\n                } else {\n                  markError();\n                }\n              }\n            });","            hls.on(Hls.Events.ERROR, (_: unknown, d: { fatal: boolean; type: string }) => {\n              if (!d.fatal) return;\n              if (retryCount.current < 3) {\n                retryCount.current++;\n                hls.startLoad(-1);\n                hls.recoverMediaError();\n              } else {\n                markError();\n              }\n            });\n\n            hls.on(Hls.Events.FRAG_BUFFERED, () => {\n              if (!readyRef.current) markReady();\n            });"],["        onClick={() => { setMuted(m => !m); setShowQuality(false); }}","        onClick={() => { setMuted(m => !m); setShowQuality(false); }}\n        onWaiting={() => { if (!error) { setBuffering(true); window.setTimeout(() => { if (!videoRef.current?.paused) setBuffering(false); }, 900); } }}\n        onStalled={() => { if (!error) setBuffering(true); }}\n        onPlaying={() => setBuffering(false)}"],["          maxBufferLength:        30,\n          maxMaxBufferLength:     60,","          maxBufferLength:        30,\n          maxMaxBufferLength:     45,\n          maxBufferSize:          24 * 1000 * 1000,\n          backBufferLength:       6,"]];
  for (const [oldText, newText] of videoPlayerReplacements) videoPlayer = videoPlayer.replace(oldText, newText);
  videoPlayer = videoPlayer
    .replace("              setQualities(lvls);\n              markReady();", "              setQualities(lvls);")
    .replace("            hls.on(Hls.Events.LEVEL_SWITCHED, (_: unknown, data: { level: number }) => {\n              setCurrentLvl(data.level);\n            });", "            hls.on(Hls.Events.LEVEL_SWITCHED, (_: unknown, data: { level: number }) => {\n              setCurrentLvl(data.level);\n            });\n\n            hls.on(Hls.Events.FRAG_BUFFERED, () => {\n              if (!readyRef.current) markReady();\n            });");
  videoPlayer = videoPlayer
    .replace("onPlaying={() => setBuffering(false)}", "onPlaying={() => setBuffering(false)}\n        onCanPlay={() => setBuffering(false)}")
    .replace("onWaiting={() => { if (!error) { setBuffering(true); window.setTimeout(() => { if (!videoRef.current?.paused) setBuffering(false); }, 900); } }}", "onWaiting={() => { if (!error) setBuffering(true); }}");
  fs.writeFileSync(videoPlayerPath, videoPlayer, 'utf8');

  let channelDetail = fs.readFileSync(channelDetailPath, 'utf8');
  const channelDetailReplacements = [["import { ArrowLeft, Heart, MessageCircle, Share2, Bookmark, Globe, PictureInPicture2, Loader2, Wifi } from 'lucide-react';","import { ArrowLeft, Heart, MessageCircle, Share2, Bookmark, Globe, PictureInPicture2, Loader2, Wifi, Maximize2, Minimize2 } from 'lucide-react';"],["  const [pipActive, setPipActive] = useState(false);","  const [pipActive, setPipActive] = useState(false);\n  const [fullscreen, setFullscreen] = useState(false);"],["      })({ enableWorker: false, maxBufferLength: 20, startLevel: -1 });","      })({\n        enableWorker: true, lowLatencyMode: false, startFragPrefetch: true,\n        maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 60 * 1000 * 1000,\n        backBufferLength: 30, liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 6,\n        maxLiveSyncPlaybackRate: 1.15, highBufferWatchdogPeriod: 2,\n        manifestLoadingMaxRetry: 3, manifestLoadingRetryDelay: 1000,\n        levelLoadingMaxRetry: 3, levelLoadingRetryDelay: 1000,\n        fragLoadingMaxRetry: 5, fragLoadingRetryDelay: 1000,\n      });"],["      hls.on('hlsManifestParsed', () => { setVideoReady(true); video.play().catch(() => {}); });","      hls.on('hlsManifestParsed', () => { video.play().catch(() => {}); });\n      hls.on('hlsFragBuffered', () => { setVideoReady(true); video.play().catch(() => {}); });"],["      hls.on('hlsError', (_: unknown, d: { fatal: boolean }) => { if (d.fatal) setVideoError(true); });","      hls.on('hlsError', (_: unknown, d: { fatal: boolean }) => { if (d.fatal) { hls.startLoad?.(-1); hls.recoverMediaError?.(); } });"],["          playsInline\n          loop","          playsInline\n          loop\n          preload=\"auto\""],["  const handlePiP = async () => {","  const handleFullscreen = async () => {\n    const video = videoRef.current; if (!video) return;\n    try {\n      if (document.fullscreenElement) { await document.exitFullscreen(); setFullscreen(false); return; }\n      await video.requestFullscreen(); setFullscreen(true);\n      try { await (screen.orientation as any)?.lock?.('landscape'); } catch {}\n    } catch {}\n  };\n\n  const handlePiP = async () => {"],["        attachMedia: (v: HTMLVideoElement) => void;\n        on: (e: string, cb: unknown) => void;","        attachMedia: (v: HTMLVideoElement) => void;\n        startLoad?: (startPosition?: number) => void;\n        recoverMediaError?: () => void;\n        on: (e: string, cb: unknown) => void;"],["      hls.on('hlsManifestParsed', () => { video.play().catch(() => {}); });","      hls.on((Hls as any).Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });"],["      hls.on('hlsFragBuffered', () => { setVideoReady(true); video.play().catch(() => {}); });","      hls.on((Hls as any).Events.FRAG_BUFFERED, () => { setVideoReady(true); video.play().catch(() => {}); });"],["      hls.on('hlsError', (_: unknown, d: { fatal: boolean }) => { if (d.fatal) { hls.startLoad?.(-1); hls.recoverMediaError?.(); } });","      hls.on((Hls as any).Events.ERROR, (_: unknown, d: { fatal: boolean }) => { if (d.fatal) { hls.startLoad?.(-1); hls.recoverMediaError?.(); } });"],["        {/* PiP button */}","        {/* Landscape/fullscreen button */}\n        <button onClick={e => { e.stopPropagation(); void handleFullscreen(); }} className=\"absolute bottom-3 right-14 w-9 h-9 rounded-full bg-black/50 backdrop-blur hover:bg-black/70 flex items-center justify-center\" aria-label={fullscreen ? 'Exit fullscreen' : 'Landscape fullscreen'}>\n          {fullscreen ? <Minimize2 className=\"w-4 h-4 text-white\" /> : <Maximize2 className=\"w-4 h-4 text-white\" />}\n        </button>\n        {/* PiP button */}"]];
  for (const [oldText, newText] of channelDetailReplacements) channelDetail = channelDetail.replace(oldText, newText);
  fs.writeFileSync(channelDetailPath, channelDetail, 'utf8');

  let channelCard = fs.readFileSync(channelCardPath, 'utf8');
  channelCard = channelCard
    .replace("shouldLoad:     boolean;", "shouldLoad:     boolean;")
    .replace("  const sharedOnReady", "  const prewarmRef = useRef(false);\n  const sharedOnReady")
    .replace("  useEffect(() => {\n    if (isActive) fetchCount();", "  useEffect(() => {\n    if (isActive) fetchCount();\n    if (shouldLoad && !isActive && !prewarmRef.current) prewarmRef.current = true;")
    .replace('className="relative w-full bg-black"', 'className="relative w-full h-[100dvh] bg-black snap-start snap-always overflow-hidden"')
    .replace("style={{ height: '100dvh', scrollSnapAlign: 'start' }}", "")
    .replace('className="absolute bottom-0 left-0 right-0 px-4 pb-6 flex items-end justify-between gap-4"', 'className="absolute bottom-0 left-0 right-0 px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] flex items-end justify-between gap-4 z-20"');
  fs.writeFileSync(feedPath, feed, 'utf8');
  fs.writeFileSync(channelCardPath, channelCard, 'utf8');

  return () => {
    for (const [file, contents] of original) fs.writeFileSync(file, contents, 'utf8');
    fs.rmSync(socialServicePath, { force: true });
  };
}

function runTikVTVBuild() {
  const vendorRoot = path.resolve(root, 'vendor', 'TikVTV');
  const packageJson = path.join(vendorRoot, 'package.json');
  if (!fs.existsSync(packageJson)) {
    process.stderr.write('[_build] ❌ TikVTV submodule is missing. Checkout with submodules enabled.\\n');
    process.exit(1);
  }

  process.stderr.write('\\n[_build] Building pinned TikVTV upstream with Testagram authentication overlay...\\n');
  const restoreAuthOverlay = patchTikVTVForTestagramAuth(vendorRoot);

  try {
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const install = spawnSync(npmBin, ['ci', '--no-audit', '--no-fund'], {
      cwd: vendorRoot,
      stdio: 'inherit',
      shell: false,
      env: { ...process.env },
    });
    if (install.error || install.status !== 0) {
      throw new Error('TikVTV dependency installation failed');
    }

    const tikBuild = spawnSync(npmBin, ['run', 'build', '--', '--base=/iptv-app/'], {
      cwd: vendorRoot,
      stdio: 'inherit',
      shell: false,
      env: { ...process.env },
    });
    if (tikBuild.error || tikBuild.status !== 0) {
      throw new Error('TikVTV production build failed');
    }

    const sourceDist = path.join(vendorRoot, 'dist');
    const snapshot = path.resolve(root, '.xclone-tikvtv-dist');
    if (!fs.existsSync(path.join(sourceDist, 'index.html'))) {
      throw new Error('TikVTV build did not produce dist/index.html');
    }
    fs.rmSync(snapshot, { recursive: true, force: true });
    fs.cpSync(sourceDist, snapshot, { recursive: true });
    process.stderr.write('[_build] ✅ TikVTV/Testagram-auth bundle captured.\\n');
  } finally {
    restoreAuthOverlay();
  }
}

function publishTikVTVBundle() {
  const snapshot = path.resolve(root, '.xclone-tikvtv-dist');
  const target = path.resolve(root, 'dist', 'iptv-app');
  const sourceIndex = path.join(snapshot, 'index.html');
  if (!fs.existsSync(sourceIndex)) {
    process.stderr.write('[_build] ❌ Captured TikVTV bundle is missing.\n');
    process.exit(1);
  }

  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(snapshot, target, { recursive: true });

  const index = fs.readFileSync(path.join(target, 'index.html'), 'utf8');
  const bootstrap = '<script>try{history.replaceState(null,"","/")}catch(e){}</script>\n';
  const entry = index.replace('</head>', bootstrap + '</head>');
  fs.writeFileSync(path.join(target, 'entry.html'), entry, 'utf8');
  fs.rmSync(snapshot, { recursive: true, force: true });
  process.stderr.write('[_build] ✅ TikVTV IPTV bundle published at dist/iptv-app.\n');
}

runTikVTVBuild();

if (!fs.existsSync(preloadPath)) {
  process.stderr.write(`[_build] ❌ Missing required repository preload: ${preloadPath}\n`);
  process.exit(1);
}

const nodeOptions = [
  '--require', preloadPath,
  '--max_old_space_size=8192',
  cleanNodeOptions(process.env.NODE_OPTIONS),
].filter(Boolean).join(' ');

const viteArgs = ['vite', 'build', ...process.argv.slice(2)];

process.stderr.write('\n[_build] ========================================\n');
process.stderr.write('[_build] Starting self-healing Vite build\n');
process.stderr.write('[_build] Node: ' + process.version + '\n');
process.stderr.write('[_build] Platform: ' + process.platform + '\n');
process.stderr.write('[_build] Preload: ' + preloadPath + '\n');
process.stderr.write('[_build] Vite args: ' + viteArgs.slice(1).join(' ') + '\n');
process.stderr.write('[_build] ========================================\n\n');

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  viteArgs,
  {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      VITE_BUILD_SOURCEMAP: 'false',
    },
  },
);

if (result.error) {
  process.stderr.write(`\n[_build] ❌ Could not start Vite: ${result.error.message}\n`);
  process.exit(1);
}
if (result.signal) {
  process.stderr.write(`\n[_build] ❌ Vite killed by signal: ${result.signal}\n`);
  process.exit(1);
}
if (result.status !== 0) {
  process.stderr.write(`\n[_build] ❌ Vite build failed (exit ${result.status})\n`);
  process.exit(result.status || 1);
}

process.stderr.write('\n[_build] ✅ Vite build completed successfully.\n');
runSeoPrerender();
publishTikVTVBundle();
