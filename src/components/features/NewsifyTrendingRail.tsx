import { useEffect, useState } from "react";
import { ExternalLink, Flame, Newspaper, RefreshCw } from "lucide-react";
import { backendCapabilities, type NewsifyTrendItem } from "@/services/testagramCapabilityClient";

const GEO = "US";
const LANGUAGE = "english";

export function NewsifyTrendingRail() {
  const [items, setItems] = useState<NewsifyTrendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await backendCapabilities.listNewsifyTrending(8, GEO, LANGUAGE);
      setItems(Array.isArray(result.items) ? result.items : []);
    } catch (error) {
      console.debug("[newsify] trending feed unavailable", error);
      if (!background) setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (loading && !items.length) {
    return (
      <section aria-label="Newsify trending" className="border-y border-border bg-background px-3 py-4">
        <div className="flex items-center gap-2 text-sm font-bold"><Newspaper className="h-4 w-4" />Newsify trending</div>
        <p className="mt-2 text-xs text-muted-foreground">Loading current trends…</p>
      </section>
    );
  }

  if (!items.length) return null;

  return (
    <section aria-label="Newsify trending" className="border-y border-border bg-background px-3 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold">Trending on Newsify</h2>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Current stories · sourced and attributed to Newsify</p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="rounded-full p-2 text-muted-foreground hover:bg-muted disabled:opacity-50"
          aria-label="Refresh Newsify trends"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
        {items.map((item) => {
          const href = item.detail_url || item.source_url;
          return (
            <article key={item.id} className="w-[300px] shrink-0 rounded-2xl border border-border bg-card p-3 shadow-sm">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="font-bold text-foreground">{item.source_name || "Newsify"}</span>
                {item.trend_title ? <><span>·</span><span className="truncate">{item.trend_title}</span></> : null}
                {item.importance_tier === 1 ? <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 font-bold text-primary">Breaking</span> : null}
              </div>
              <h3 className="mt-2 line-clamp-3 text-sm font-bold leading-snug">{item.title}</h3>
              {item.excerpt ? <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{item.excerpt}</p> : null}
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {item.geo} · {item.language}
                </span>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                  >
                    Read article <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}