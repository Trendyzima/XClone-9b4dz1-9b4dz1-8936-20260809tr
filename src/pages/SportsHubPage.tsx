import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, CalendarDays, CheckCircle2, ChevronDown, CircleAlert, Clock3, ExternalLink, ImageOff, Newspaper, RefreshCw, Trophy } from 'lucide-react';
import { supabasePublishableKey, supabaseUrl } from '@/lib/supabase';

type Match = Record<string, unknown>;
type SportsStory = {
  id: string;
  title: string;
  excerpt?: string | null;
  canonical_url: string;
  image_url?: string | null;
  published_at: string;
  category?: string | null;
  country_code?: string | null;
  testagram_rss_source_profiles?: { display_name?: string | null } | null;
};

const SPORTS = [
  { value: 'football', label: 'Football', mark: '⚽' },
  { value: 'basketball', label: 'Basketball', mark: '🏀' },
  { value: 'cricket', label: 'Cricket', mark: '🏏' },
  { value: 'tennis', label: 'Tennis', mark: '🎾' },
];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function display(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const obj = record(value);
  if (!obj) return '';
  for (const key of ['name', 'title', 'shortName', 'displayName', 'score', 'text', 'value']) {
    const found = obj[key];
    if (typeof found === 'string' || typeof found === 'number') return String(found);
  }
  return '';
}
function first(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  return undefined;
}
function flattenMatches(data: unknown): Match[] {
  const root = record(data);
  if (!root) return [];
  const direct = first(root, ['matches', 'events', 'items']);
  if (Array.isArray(direct)) return direct.map(record).filter((item): item is Match => Boolean(item));
  return Array.isArray(root.leagues)
    ? root.leagues.flatMap(value => {
      const league = record(value);
      return Array.isArray(league?.matches) ? league.matches.map(record).filter((item): item is Match => Boolean(item)) : [];
    })
    : [];
}
function matchTeam(match: Match, side: 'home' | 'away'): string {
  const value = first(match, side === 'home'
    ? ['homeTeam', 'home', 'home_team', 'homeTeamName', 'home_name']
    : ['awayTeam', 'away', 'away_team', 'awayTeamName', 'away_name']);
  return display(value) || (side === 'home' ? 'Home' : 'Away');
}
function matchScore(match: Match, side: 'home' | 'away'): string {
  const value = first(match, side === 'home'
    ? ['homeScore', 'home_score', 'homeGoals']
    : ['awayScore', 'away_score', 'awayGoals']);
  if (value !== undefined) return display(value);
  const score = record(match.score);
  return score ? display(score[side]) : '';
}
function matchStatus(match: Match): string {
  return display(first(match, ['status', 'state', 'matchStatus', 'time', 'minute', 'date'])) || 'Fixture';
}
function isLive(status: string): boolean {
  return /live|in.?play|half.?time|1st half|2nd half|quarter|set [1-5]|innings/i.test(status);
}
function age(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'Recently';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes + 'm ago';
  if (minutes < 1440) return Math.floor(minutes / 60) + 'h ago';
  return Math.floor(minutes / 1440) + 'd ago';
}
function storySport(story: SportsStory): string {
  const value = (story.category || 'sports').toLowerCase();
  return SPORTS.find(item => item.value === value)?.label || 'Sports';
}

export default function SportsHubPage() {
  const [sport, setSport] = useState('football');
  const [matches, setMatches] = useState<Match[]>([]);
  const [stories, setStories] = useState<SportsStory[]>([]);
  const [scoresLoading, setScoresLoading] = useState(true);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scoresError, setScoresError] = useState('');
  const [storiesError, setStoriesError] = useState('');
  const [expandedStoryId, setExpandedStoryId] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const scoresController = useRef<AbortController | null>(null);
  const storiesController = useRef<AbortController | null>(null);

  const loadScores = useCallback(async (manual = false) => {
    scoresController.current?.abort();
    const controller = new AbortController();
    scoresController.current = controller;
    if (manual) setRefreshing(true);
    else { setScoresLoading(true); setRefreshing(false); }
    setScoresError('');
    try {
      const params = new URLSearchParams({ kind: 'matches', sport, limit: '30' });
      const response = await fetch(supabaseUrl + '/functions/v1/testagram-sports?' + params.toString(), {
        headers: { Accept: 'application/json', apikey: supabasePublishableKey },
        credentials: 'omit',
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Scores are temporarily unavailable');
      setMatches(flattenMatches(payload.data));
    } catch (error) {
      if (controller.signal.aborted) return;
      setScoresError(error instanceof Error ? error.message : 'Scores are temporarily unavailable');
      setMatches([]);
    } finally {
      if (!controller.signal.aborted) {
        setScoresLoading(false);
        setRefreshing(false);
      }
    }
  }, [sport]);

  const loadStories = useCallback(async () => {
    storiesController.current?.abort();
    const controller = new AbortController();
    storiesController.current = controller;
    setStoriesLoading(true);
    setStoriesError('');
    try {
      const response = await fetch(supabaseUrl + '/functions/v1/testagram-rss-feed?limit=20&category=sports', {
        headers: { Accept: 'application/json', apikey: supabasePublishableKey },
        credentials: 'omit',
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Sports headlines are temporarily unavailable');
      const nextStories = Array.isArray(payload?.items) ? payload.items as SportsStory[] : [];
      setStories(nextStories);
      setFailedImages([]);
    } catch (error) {
      if (controller.signal.aborted) return;
      setStoriesError(error instanceof Error ? error.message : 'Sports headlines are temporarily unavailable');
    } finally {
      if (!controller.signal.aborted) setStoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScores();
    return () => scoresController.current?.abort();
  }, [loadScores]);

  useEffect(() => {
    void loadStories();
    return () => storiesController.current?.abort();
  }, [loadStories]);

  useEffect(() => {
    document.title = 'Testagram Sports — Live scores, fixtures & headlines';
    const timer = window.setInterval(() => { void loadScores(true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadScores]);

  const liveMatches = matches.filter(match => isLive(matchStatus(match)));
  const featuredStories = stories.slice(0, 1);
  const remainingStories = stories.slice(1);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-7">
        <header className="relative isolate mb-7 overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950 text-white shadow-xl">
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,rgba(34,197,94,0.34),transparent_45%),radial-gradient(ellipse_at_bottom_left,rgba(59,130,246,0.24),transparent_45%)]" />
          <div className="grid gap-6 p-5 sm:p-8 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-300">
                <Trophy className="h-3.5 w-3.5" /> Testagram Sports
              </div>
              <h1 className="max-w-2xl text-3xl font-black leading-tight tracking-tight sm:text-5xl">Every game has a story.</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">Live scores, upcoming fixtures and the headlines moving sport — in one fast, mobile-first feed.</p>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-300">
                <span className="inline-flex items-center gap-1.5"><Activity className="h-4 w-4 text-emerald-300" /> Live updates</span>
                <span className="inline-flex items-center gap-1.5"><Newspaper className="h-4 w-4 text-sky-300" /> Publisher headlines</span>
                <span className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4 text-violet-300" /> Refreshes every minute</span>
              </div>
            </div>
            <button type="button" onClick={() => { void loadScores(true); void loadStories(); }} disabled={refreshing || storiesLoading} className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full bg-white px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60 md:self-end">
              <RefreshCw className={'h-4 w-4 ' + (refreshing || storiesLoading ? 'animate-spin' : '')} /> Refresh feed
            </button>
          </div>
          <div className="border-t border-white/10 bg-black/15 px-4 py-4 sm:px-8">
            <div className="flex items-center gap-2 overflow-x-auto pb-1" aria-label="Choose sport">
              {SPORTS.map(option => <button key={option.value} type="button" onClick={() => setSport(option.value)} aria-pressed={sport === option.value} className={'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-bold transition ' + (sport === option.value ? 'bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-950/30' : 'border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10')}>
                <span aria-hidden="true">{option.mark}</span>{option.label}
              </button>)}
            </div>
          </div>
        </header>

        <section className="mb-9" aria-labelledby="sports-scores-heading">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="mb-1 text-[11px] font-black uppercase tracking-[0.16em] text-primary">The scoreboard</p>
              <h2 id="sports-scores-heading" className="flex items-center gap-2 text-xl font-black sm:text-2xl"><Activity className="h-5 w-5 text-primary" /> Scores & fixtures</h2>
            </div>
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"><RefreshCw className="h-3.5 w-3.5" /> Auto-refresh · 60 sec</span>
          </div>

          {liveMatches.length > 0 && (
            <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-3 sm:p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-red-500"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Live now <span className="rounded-full bg-red-500/10 px-2 py-0.5">{liveMatches.length}</span></div>
              <div className="grid gap-3 md:grid-cols-2">
                {liveMatches.slice(0, 4).map((match, index) => <MatchCard key={display(first(match, ['id', 'matchId', 'slug'])) || matchTeam(match, 'home') + index} match={match} sport={sport} live />)}
              </div>
            </div>
          )}

          {scoresLoading && matches.length === 0 ? <div className="grid gap-3 sm:grid-cols-2"><div className="h-28 animate-pulse rounded-2xl bg-muted" /><div className="h-28 animate-pulse rounded-2xl bg-muted" /></div>
            : scoresError ? <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-5" role="alert">
              <div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div className="min-w-0 flex-1"><p className="font-bold">Scores couldn’t load just now</p><p className="mt-1 break-words text-sm text-muted-foreground">{scoresError}</p><p className="mt-2 text-xs text-muted-foreground">Your headlines remain available. Try again in a moment.</p><button type="button" className="mt-3 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold hover:bg-accent" onClick={() => void loadScores(true)}><RefreshCw className="h-4 w-4" /> Try scores again</button></div></div>
            </div>
            : matches.length === 0 ? <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground"><div className="flex items-center gap-3"><CalendarDays className="h-5 w-5 shrink-0 text-primary" /><p>No score entries are available for {sport} right now. Try another sport or refresh shortly.</p></div></div>
            : <div className="grid gap-3 sm:grid-cols-2">{matches.filter(match => !isLive(matchStatus(match))).slice(0, 8).map((match, index) => <MatchCard key={display(first(match, ['id', 'matchId', 'slug'])) || matchTeam(match, 'home') + index} match={match} sport={sport} />)}</div>}
          <p className="mt-3 text-xs text-muted-foreground">Scores and fixtures <a href="https://sportscore.com/" target="_blank" rel="noopener noreferrer" className="font-semibold underline decoration-primary/50 underline-offset-2 hover:text-primary">Powered by SportScore <ExternalLink className="inline h-3 w-3" /></a>.</p>
        </section>

        <section aria-labelledby="sports-news-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-1 text-[11px] font-black uppercase tracking-[0.16em] text-primary">Across the sports world</p>
              <h2 id="sports-news-heading" className="flex items-center gap-2 text-xl font-black sm:text-2xl"><Newspaper className="h-5 w-5 text-primary" /> Latest sports headlines</h2>
              <p className="mt-1 text-sm text-muted-foreground">Stories from trusted publishers, including coverage from Kenya.</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Publisher-attributed</span>
          </div>

          {storiesLoading && stories.length === 0 ? <div className="grid gap-4 sm:grid-cols-2"><div className="h-72 animate-pulse rounded-2xl bg-muted" /><div className="h-72 animate-pulse rounded-2xl bg-muted" /></div>
            : storiesError && stories.length === 0 ? <div className="rounded-2xl border p-5" role="alert"><p className="font-bold">Sports headlines are temporarily unavailable</p><p className="mt-1 text-sm text-muted-foreground">{storiesError}</p><button type="button" className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline" onClick={() => void loadStories()}><RefreshCw className="h-4 w-4" /> Try headlines again</button></div>
            : stories.length === 0 ? <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">No recent sports headlines are available yet. The publisher feed will appear here as new stories are ingested.</div>
            : <>
              {featuredStories.length > 0 && <div className="mb-4 grid gap-4 md:grid-cols-2">
                {featuredStories.map((story, index) => <StoryCard key={story.id} story={story} featured={index === 0} expanded={expandedStoryId === story.id} imageFailed={failedImages.includes(story.id)} onToggle={() => setExpandedStoryId(current => current === story.id ? null : story.id)} onImageError={() => setFailedImages(current => current.includes(story.id) ? current : [...current, story.id])} />)}
              </div>}
              {remainingStories.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {remainingStories.map(story => <StoryCard key={story.id} story={story} expanded={expandedStoryId === story.id} imageFailed={failedImages.includes(story.id)} onToggle={() => setExpandedStoryId(current => current === story.id ? null : story.id)} onImageError={() => setFailedImages(current => current.includes(story.id) ? current : [...current, story.id])} />)}
              </div>}
              {storiesError && <p className="mt-3 text-xs text-muted-foreground">Showing the last available headlines. Refresh to try loading newer stories.</p>}
            </>}
          <p className="mt-4 text-xs leading-5 text-muted-foreground">Headlines and images are attributed to their publishers. Read each story here for a short preview, or use the optional source link for the complete report.</p>
        </section>
      </div>
    </main>
  );
}

function MatchCard({ match, sport, live = false }: { match: Match; sport: string; live?: boolean }) {
  const home = matchTeam(match, 'home');
  const away = matchTeam(match, 'away');
  const status = matchStatus(match);
  const league = display(first(match, ['league', 'competition', 'tournament']));
  return <article className={'rounded-2xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm ' + (live ? 'border-red-500/20' : '')}>
    <div className="mb-4 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span className="truncate font-semibold">{league || sport.charAt(0).toUpperCase() + sport.slice(1)}</span>{live ? <span className="inline-flex shrink-0 items-center gap-1.5 font-black text-red-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> LIVE</span> : <span className="shrink-0">{status}</span>}</div>
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
      <span className="truncate text-sm font-bold">{home}</span>
      <span className="rounded-xl bg-muted px-3 py-2 text-base font-black tabular-nums">{matchScore(match, 'home') || '–'} <span className="text-muted-foreground">:</span> {matchScore(match, 'away') || '–'}</span>
      <span className="truncate text-right text-sm font-bold">{away}</span>
    </div>
    {live && <p className="mt-3 text-[11px] text-muted-foreground">{status}</p>}
  </article>;
}

function StoryCard({ story, featured = false, expanded, imageFailed, onToggle, onImageError }: {
  story: SportsStory;
  featured?: boolean;
  expanded: boolean;
  imageFailed: boolean;
  onToggle: () => void;
  onImageError: () => void;
}) {
  const publisher = story.testagram_rss_source_profiles?.display_name || 'Sports publisher';
  const imageUrl = story.image_url?.trim();
  const showImage = Boolean(imageUrl && !imageFailed);
  return <article className={'group overflow-hidden rounded-2xl border bg-card transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-black/5 ' + (featured ? 'md:grid md:grid-cols-[0.95fr_1.05fr]' : '')}>
    <div className={'relative isolate overflow-hidden bg-slate-900 ' + (featured ? 'aspect-[16/10] md:aspect-auto md:min-h-[260px]' : 'aspect-[16/9]')}>
      {showImage ? <img src={imageUrl} alt="" loading={featured ? 'eager' : 'lazy'} decoding="async" onError={onImageError} className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
        : <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.55),transparent_48%),linear-gradient(135deg,#0f172a,#1e293b_55%,#064e3b)]"><div className="absolute -right-8 -top-12 h-44 w-44 rounded-full border border-white/10" /><div className="absolute -right-1 -top-5 h-32 w-32 rounded-full border border-white/10" /><div className="absolute bottom-4 left-5 flex items-center gap-2 text-white/80"><ImageOff className="h-4 w-4" /><span className="text-[10px] font-black uppercase tracking-[0.2em]">{storySport(story)} · Matchday</span></div><Trophy className="absolute right-7 top-1/2 h-12 w-12 -translate-y-1/2 text-white/20" /></div>}
      <div className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/55 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur-sm">{story.country_code === 'KE' ? 'KENYA SPORTS' : 'SPORTS NEWS'}</div>
    </div>
    <div className="p-4 sm:p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1.5 font-semibold"><Newspaper className="h-3.5 w-3.5" />{publisher}</span><span aria-hidden="true">·</span><span>{age(story.published_at)}</span></div>
      <button type="button" aria-expanded={expanded} onClick={onToggle} className="block w-full rounded-sm text-left text-base font-black leading-snug tracking-tight hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-lg">{story.title}</button>
      {story.excerpt && <p className={'mt-2 text-sm leading-6 text-muted-foreground ' + (expanded ? '' : 'line-clamp-3')}>{story.excerpt}</p>}
      {expanded && <div className="mt-3 rounded-xl bg-muted/60 p-3"><p className="text-xs leading-5 text-muted-foreground">This is a publisher-supplied preview, not the complete article. Open the original report for full coverage and any updates.</p><a href={story.canonical_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:opacity-90">Open original report <ArrowUpRight className="h-3.5 w-3.5" /></a></div>}
      {!expanded && <button type="button" onClick={onToggle} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">Read story here <ChevronDown className="h-3.5 w-3.5" /></button>}
      {!expanded && <a href={story.canonical_url} target="_blank" rel="noopener noreferrer" className="ml-4 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary hover:underline">Original source <ExternalLink className="h-3.5 w-3.5" /></a>}
    </div>
  </article>;
}
