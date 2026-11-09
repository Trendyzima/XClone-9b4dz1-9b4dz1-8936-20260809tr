import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, Search, ShoppingBag, Star } from 'lucide-react';
import { backendCapabilities } from '@/services/testagramCapabilityClient';

type MarketplaceProduct = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  price?: string | number;
  currency?: string;
  image_url?: string;
  external_link?: string;
  avg_rating?: number;
  review_count?: number;
  is_featured?: boolean;
  user_profiles?: {
    username?: string;
    display_name?: string;
    avatar_url?: string;
    verified_tier?: string;
  };
};

const CATEGORIES = [
  { value: 'all', label: 'All products' },
  { value: 'digital', label: 'Digital' },
  { value: 'handmade', label: 'Handmade' },
  { value: 'fashion', label: 'Fashion' },
  { value: 'art', label: 'Art' },
  { value: 'food', label: 'Food' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'other', label: 'Other' },
];

function safeExternalURL(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatPrice(price: MarketplaceProduct['price'], currency?: string) {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return 'Price on request';
  const code = /^[A-Z]{3}$/.test(currency ?? '') ? currency! : 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

export default function MarketplacePage() {
  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const timeout = window.setTimeout(async () => {
      try {
        const result = await backendCapabilities.listMarketplaceProducts(60, category, query);
        if (active) setProducts(Array.isArray(result.items) ? result.items as MarketplaceProduct[] : []);
      } catch (cause) {
        if (active) {
          setProducts([]);
          setError(cause instanceof Error ? cause.message : 'Marketplace catalog could not be loaded.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }, query.trim() ? 250 : 0);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [category, query]);

  const featuredCount = useMemo(() => products.filter(product => product.is_featured).length, [products]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <ShoppingBag className="h-3.5 w-3.5" /> Testagram Marketplace
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Discover products</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Explore products listed by creators and sellers in the Testagram community.
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            {products.length} {products.length === 1 ? 'listing' : 'listings'}
            {featuredCount > 0 ? ` · ${featuredCount} featured` : ''}
          </div>
        </header>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row">
          <label className="relative block flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search products…"
              aria-label="Search marketplace products"
              className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </label>
          <label className="sm:w-56">
            <span className="sr-only">Product category</span>
            <select
              value={category}
              onChange={event => setCategory(event.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              {CATEGORIES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading marketplace…
          </div>
        ) : error ? (
          <div role="alert" className="mx-auto flex max-w-2xl items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <h2 className="font-semibold">Marketplace is temporarily unavailable</h2>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              <button onClick={() => { setCategory(value => value); setQuery(value => value + ' '); setQuery(value => value.trim()); }} className="mt-3 text-sm font-semibold text-primary hover:underline">
                Retry loading
              </button>
            </div>
          </div>
        ) : products.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 text-center">
            <ShoppingBag className="mb-3 h-9 w-9 text-muted-foreground/60" />
            <h2 className="font-semibold">No products found</h2>
            <p className="mt-1 text-sm text-muted-foreground">Try another search or choose a different category.</p>
          </div>
        ) : (
          <section aria-label="Marketplace products" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map(product => {
              const externalURL = safeExternalURL(product.external_link);
              const seller = product.user_profiles?.display_name || product.user_profiles?.username || 'Testagram seller';
              return (
                <article key={product.id} className="group overflow-hidden rounded-2xl border border-border bg-card transition hover:-translate-y-0.5 hover:shadow-lg">
                  <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                    ) : (
                      <div className="flex h-full items-center justify-center"><ShoppingBag className="h-12 w-12 text-muted-foreground/40" /></div>
                    )}
                    {product.is_featured && <span className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground">Featured</span>}
                  </div>
                  <div className="p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium capitalize text-muted-foreground">{product.category || 'other'}</span>
                      {Number(product.review_count) > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {Number(product.avg_rating || 0).toFixed(1)} ({product.review_count})
                        </span>
                      )}
                    </div>
                    <h2 className="line-clamp-1 font-semibold">{product.name}</h2>
                    <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">{product.description || 'No description provided.'}</p>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold">{formatPrice(product.price, product.currency)}</p>
                        <p className="truncate text-xs text-muted-foreground">by {seller}</p>
                      </div>
                      {externalURL ? (
                        <a href={externalURL} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90">
                          View listing <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="shrink-0 rounded-lg bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">Details soon</span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Product discovery is live. Checkout and in-platform order processing will be enabled when the secure commerce and settlement API is complete.
        </p>
      </div>
    </main>
  );
}
