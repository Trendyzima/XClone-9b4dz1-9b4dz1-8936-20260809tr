import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import {
  CheckCircle, AlertTriangle, XCircle, RefreshCw, ExternalLink,
  Search, FileText, Globe, Shield, BarChart2, Loader2,
  ChevronDown, ChevronUp, Download
} from 'lucide-react';
import { toast } from 'sonner';
import { SEO_COVERAGE, scoreSEORoute, type SEORoute } from '@/lib/seoValidation';

import { PageAdBanner } from '@/components/features/AdSenseAd';
function SEOAuditAdBanner() { return <PageAdBanner />; }

const BASE = 'https://testagram.site';

interface RouteAudit {
  path: string;
  label: string;
  group: string;
  hasUseSEO: boolean;
  hasStructuredData: boolean;
  noindex: boolean;
  title: string | null;
  description: string | null;
  ogImage: string | null;
  canonical: string | null;
  status: 'good' | 'warn' | 'missing' | 'noindex' | 'loading';
}

const ROUTE_MANIFEST: SEORoute[] =
  SEO_COVERAGE.map(r => ({
    path: r.path,
    label: r.label,
    group: r.group,
    hasUseSEO: r.hasUseSEO,
    hasStructuredData: r.hasStructuredData,
    noindex: r.noindex,
  }));

function scoreRoute(route: SEORoute): RouteAudit['status'] {
  return scoreSEORoute(route as SEORoute);
}

// Pure helpers — replace Record<status,T> module-scope object (esbuild guard)
function getStatusColor(s: RouteAudit['status']): string {
  if (s === 'good')    return 'text-green-600';
  if (s === 'warn')    return 'text-amber-600';
  if (s === 'missing') return 'text-red-600';
  if (s === 'noindex') return 'text-slate-500';
  return 'text-primary';
}
function getStatusBg(s: RouteAudit['status']): string {
  if (s === 'good')    return 'bg-green-500/10 border-green-500/20';
  if (s === 'warn')    return 'bg-amber-500/10 border-amber-500/20';
  if (s === 'missing') return 'bg-red-500/10 border-red-500/20';
  if (s === 'noindex') return 'bg-slate-500/10 border-slate-500/20';
  return 'bg-primary/10 border-primary/20';
}
function getStatusLabel(s: RouteAudit['status']): string {
  if (s === 'good')    return 'Good';
  if (s === 'warn')    return 'Warn';
  if (s === 'missing') return 'Missing';
  if (s === 'noindex') return 'Noindex';
  return '...';
}

function StatusIcon({ status, className }: { status: RouteAudit['status']; className?: string }) {
  if (status === 'good')    return <CheckCircle className={className} />;
  if (status === 'warn')    return <AlertTriangle className={className} />;
  if (status === 'missing') return <XCircle className={className} />;
  if (status === 'noindex') return <Shield className={className} />;
  return <Loader2 className={className} />;
}

const GROUPS = ['Core', 'Hashtags', 'Trending', 'Communities', 'Dynamic', 'Private', 'Admin'];

export default function SEOAuditPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [routes, setRoutes] = useState<RouteAudit[]>(() =>
    ROUTE_MANIFEST.map(r => ({
      ...r,
      title: null,
      description: null,
      ogImage: null,
      canonical: null,
      status: scoreRoute(r),
    }))
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Core', 'Hashtags', 'Trending', 'Communities', 'Dynamic']));
  const [filterStatus, setFilterStatus] = useState<'all' | 'good' | 'warn' | 'missing'>('all');
  const [sitemap, setSitemap] = useState<{ loading: boolean; urls: number; error: string | null }>({ loading: false, urls: 0, error: null });

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    (async () => {
      const { data } = await supabase.from('admin_users').select('id').eq('user_id', user.id).maybeSingle();
      setIsAdmin(!!data);
      setCheckingAdmin(false);
    })();
  }, [user]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchSitemapStats();
  }, [isAdmin]);

  const fetchSitemapStats = async () => {
    setSitemap(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL?.replace('/v1', '')}/functions/v1/community-sitemap`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const matches = text.match(/<url>/g);
      setSitemap({ loading: false, urls: matches?.length ?? 0, error: null });
    } catch (err: any) {
      setSitemap({ loading: false, urls: 0, error: err.message });
    }
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const handleExportCsv = () => {
    const rows = [
      ['Path', 'Label', 'Group', 'useSEO', 'Structured Data', 'Noindex', 'Status'],
      ...routes.map(r => [r.path, r.label, r.group, r.hasUseSEO ? 'Yes' : 'No', r.hasStructuredData ? 'Yes' : 'No', r.noindex ? 'Yes' : 'No', r.status]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seo-audit-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Audit exported as CSV');
  };

  const counts = {
    good:    routes.filter(r => r.status === 'good').length,
    warn:    routes.filter(r => r.status === 'warn').length,
    missing: routes.filter(r => r.status === 'missing').length,
    noindex: routes.filter(r => r.status === 'noindex').length,
  };
  const score = Math.round((counts.good / (routes.length - counts.noindex)) * 100);

  const filteredRoutes = filterStatus === 'all'
    ? routes
    : routes.filter(r => r.status === filterStatus);

  // Use plain object — no index-sig annotation on accumulator (esbuild guard)
  const groupedRoutes: any = {};
  for (const g of GROUPS) {
    groupedRoutes[g] = filteredRoutes.filter(r => r.group === g);
  }

  if (checkingAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title="SEO Audit" showBack />
        <SEOAuditAdBanner />
        <div className="flex flex-col items-center justify-center py-24 text-center px-6">
          <Shield className="w-16 h-16 text-destructive/40 mb-4" />
          <h2 className="text-xl font-bold">Admin Access Required</h2>
          <p className="text-muted-foreground mt-2">This page is restricted to platform admins.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="SEO Audit" showBack />
      <SEOAuditAdBanner />

      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border bg-gradient-to-br from-primary/5 to-background">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BarChart2 className="w-5 h-5 text-primary" />
              <h1 className="font-bold text-lg">SEO Coverage Audit</h1>
            </div>
            <p className="text-xs text-muted-foreground">Static analysis of SEO hook coverage across all routes</p>
          </div>
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-2 bg-muted rounded-xl text-xs font-semibold hover:bg-muted/70 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />CSV
          </button>
        </div>

        {/* Score ring + stats */}
        <div className="mt-4 grid grid-cols-5 gap-2">
          <div className="col-span-1 flex flex-col items-center justify-center bg-muted/30 rounded-2xl p-3 border border-border">
            <div className={`text-3xl font-black ${score >= 70 ? 'text-green-600' : score >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
              {isNaN(score) ? '—' : `${score}%`}
            </div>
            <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wide mt-0.5">Score</p>
          </div>
          {[
            { label: 'Good',    count: counts.good,    color: 'text-green-600' },
            { label: 'Warn',    count: counts.warn,    color: 'text-amber-600' },
            { label: 'Missing', count: counts.missing, color: 'text-red-600' },
            { label: 'Noindex', count: counts.noindex, color: 'text-slate-500' },
          ].map(({ label, count, color }) => (
            <button
              key={label}
              onClick={() => setFilterStatus(filterStatus === label.toLowerCase() as any ? 'all' : label.toLowerCase() as any)}
              className={`col-span-1 flex flex-col items-center justify-center rounded-2xl p-3 border transition-all ${
                filterStatus === label.toLowerCase()
                  ? 'bg-foreground/10 border-foreground/20 scale-[0.97]'
                  : 'bg-muted/30 border-border hover:border-muted-foreground/30'
              }`}
            >
              <span className={`text-2xl font-black ${color}`}>{count}</span>
              <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wide mt-0.5">{label}</p>
            </button>
          ))}
        </div>

        {/* Segmented score progress bar */}
        <div className="mt-3">
          <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden flex">
            {(() => {
              const goodPct    = (counts.good    / routes.length) * 100;
              const warnPct    = (counts.warn    / routes.length) * 100;
              const missingPct = (counts.missing / routes.length) * 100;
              const noindexPct = (counts.noindex / routes.length) * 100;
              return (
                <>
                  <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${goodPct}%` }} title={`Good: ${counts.good}`} />
                  <div className="h-full bg-amber-400 transition-all duration-500" style={{ width: `${warnPct}%` }} title={`Warn: ${counts.warn}`} />
                  <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${missingPct}%` }} title={`Missing: ${counts.missing}`} />
                  <div className="h-full bg-slate-400/50 transition-all duration-500" style={{ width: `${noindexPct}%` }} title={`Noindex: ${counts.noindex}`} />
                </>
              );
            })()}
          </div>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {[
              { color: 'bg-green-500',      label: 'Good',    count: counts.good    },
              { color: 'bg-amber-400',      label: 'Warn',    count: counts.warn    },
              { color: 'bg-red-500',        label: 'Missing', count: counts.missing },
              { color: 'bg-slate-400/50',   label: 'Noindex', count: counts.noindex },
            ].map(({ color, label, count }) => (
              <div key={label} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${color}`} />
                <span className="text-[10px] text-muted-foreground font-medium">{label} <strong className="text-foreground">{count}</strong></span>
              </div>
            ))}
            <span className="ml-auto text-[10px] text-muted-foreground">{routes.length} total routes</span>
          </div>
        </div>
      </div>

      {/* Sitemap panel */}
      <div className="px-4 pt-3 pb-3 border-b border-border">
        <div className="bg-muted/30 rounded-2xl p-4 border border-border">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-sm">Community Sitemap (Dynamic)</h3>
            </div>
            <button
              onClick={fetchSitemapStats}
              disabled={sitemap.loading}
              className="p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${sitemap.loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {sitemap.loading ? (
            <p className="text-xs text-muted-foreground">Fetching sitemap…</p>
          ) : sitemap.error ? (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <XCircle className="w-3.5 h-3.5" />
              <span>{sitemap.error}</span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-green-600 font-semibold">
                <CheckCircle className="w-3.5 h-3.5" />
                {sitemap.urls} community URLs indexed
              </div>
              <a
                href={`${import.meta.env.VITE_SUPABASE_URL?.replace('/v1', '')}/functions/v1/community-sitemap`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />View XML
              </a>
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <a
              href="/sitemap.xml"
              target="_blank"
              rel="noopener"
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
            >
              <FileText className="w-3 h-3" />sitemap.xml (index)
            </a>
            <span className="text-muted-foreground/30 text-xs">·</span>
            <a
              href="/sitemap-static.xml"
              target="_blank"
              rel="noopener"
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
            >
              <FileText className="w-3 h-3" />sitemap-static.xml
            </a>
          </div>
        </div>
      </div>

      {/* Filter chips */}
      <div className="px-4 pt-3 flex gap-2 flex-wrap">
        {(['all', 'good', 'warn', 'missing'] as const).map(s => {
          const active = filterStatus === s;
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors capitalize ${
                active
                  ? s === 'all' ? 'bg-foreground text-background border-foreground'
                  : s === 'good' ? 'bg-green-600 text-white border-green-600'
                  : s === 'warn' ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-red-600 text-white border-red-600'
                  : 'bg-transparent border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {s === 'all' ? `All (${routes.length})` : `${s.charAt(0).toUpperCase() + s.slice(1)} (${counts[s as keyof typeof counts]})`}
            </button>
          );
        })}
      </div>

      {/* Route groups */}
      <div className="px-4 pt-3 space-y-3 pb-8">
        {GROUPS.map(group => {
          const groupRoutes = groupedRoutes[group];
          if (!groupRoutes?.length) return null;
          const isExpanded = expandedGroups.has(group);
          const groupGood = groupRoutes.filter(r => r.status === 'good').length;
          const groupWarn = groupRoutes.filter(r => r.status === 'warn').length;
          const groupMissing = groupRoutes.filter(r => r.status === 'missing').length;

          return (
            <div key={group} className="border border-border rounded-2xl overflow-hidden">
              <button
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-bold text-sm">{group}</span>
                  <div className="flex items-center gap-1.5">
                    {groupGood > 0 && <span className="text-[10px] bg-green-500/10 text-green-600 border border-green-500/20 px-1.5 py-0.5 rounded-full font-semibold">{groupGood} good</span>}
                    {groupWarn > 0 && <span className="text-[10px] bg-amber-500/10 text-amber-600 border border-amber-500/20 px-1.5 py-0.5 rounded-full font-semibold">{groupWarn} warn</span>}
                    {groupMissing > 0 && <span className="text-[10px] bg-red-500/10 text-red-600 border border-red-500/20 px-1.5 py-0.5 rounded-full font-semibold">{groupMissing} missing</span>}
                  </div>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>

              {isExpanded && (
                <div className="divide-y divide-border">
                  {groupRoutes.map(route => {
                    const cfgColor = getStatusColor(route.status);
                  const cfgBg    = getStatusBg(route.status);
                  const cfgLabel = getStatusLabel(route.status);
                    return (
                      <div key={route.path} className="px-4 py-3 hover:bg-muted/20 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="font-semibold text-sm truncate">{route.label}</p>
                              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${cfgBg} ${cfgColor}`}>
                                <StatusIcon status={route.status} className={`w-2.5 h-2.5 ${route.status === 'loading' ? 'animate-spin' : ''}`} />
                                {cfgLabel}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground font-mono truncate">{route.path}</p>

                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              <span className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-semibold border ${
                                route.hasUseSEO ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'
                              }`}>
                                <Search className="w-2 h-2" />useSEO
                                {route.hasUseSEO ? ' ✓' : ' ✗'}
                              </span>
                              <span className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-semibold border ${
                                route.hasStructuredData ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'bg-muted text-muted-foreground border-border'
                              }`}>
                                <FileText className="w-2 h-2" />JSON-LD
                                {route.hasStructuredData ? ' ✓' : ' —'}
                              </span>
                              <span className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-semibold border ${
                                route.noindex ? 'bg-slate-500/10 text-slate-500 border-slate-500/20' : 'bg-green-500/10 text-green-600 border-green-500/20'
                              }`}>
                                <Globe className="w-2 h-2" />
                                {route.noindex ? 'noindex' : 'indexable'}
                              </span>
                            </div>
                          </div>

                          <div className="flex gap-1.5 shrink-0">
                            {!route.path.includes('{') && (
                              <a
                                href={`${BASE}${route.path}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                title="Open page"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        </div>

                        {route.status === 'missing' && (
                          <div className="mt-2 px-2 py-1.5 bg-red-500/5 border border-red-500/15 rounded-lg">
                            <p className="text-[10px] text-red-600 font-medium">
                              ⚠ Add <code className="bg-red-500/10 px-0.5 rounded">useSEO()</code> hook to this page component for indexable meta tags and structured data.
                            </p>
                          </div>
                        )}
                        {route.status === 'warn' && !route.noindex && !route.hasStructuredData && (
                          <div className="mt-2 px-2 py-1.5 bg-amber-500/5 border border-amber-500/15 rounded-lg">
                            <p className="text-[10px] text-amber-600 font-medium">
                              💡 Add JSON-LD structured data via <code className="bg-amber-500/10 px-0.5 rounded">structuredData</code> prop in useSEO for rich search snippets.
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="px-4 pb-8">
        <div className="bg-muted/30 rounded-2xl p-4 border border-border">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">Legend</p>
          <div className="space-y-2">
            {[
              { color: 'text-green-600', bg: 'bg-green-500/10 border-green-500/20', label: 'Good', desc: 'useSEO + structured data present' },
              { color: 'text-amber-600', bg: 'bg-amber-500/10 border-amber-500/20', label: 'Warn', desc: 'useSEO present but no JSON-LD, or could be improved' },
              { color: 'text-red-600',   bg: 'bg-red-500/10 border-red-500/20',     label: 'Missing', desc: 'No useSEO hook — only static index.html meta tags' },
              { color: 'text-slate-500', bg: 'bg-slate-500/10 border-slate-500/20', label: 'Noindex', desc: 'Private/auth pages — intentionally excluded from search' },
            ].map(({ color, bg, label, desc }) => (
              <div key={label} className="flex items-start gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${bg} ${color}`}>{label}</span>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
