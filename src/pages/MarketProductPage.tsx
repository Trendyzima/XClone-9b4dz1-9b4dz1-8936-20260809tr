import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, CheckCircle2, Copy, ExternalLink, Loader2, Share2, ShoppingBag, Store } from 'lucide-react';
import { toast } from 'sonner';
import { backendCapabilities } from '@/services/testagramCapabilityClient';

type Product = {
  id: string;
  owner_id: string;
  name: string;
  description?: string | null;
  price: string | number;
  currency: string;
  category: string;
  image_url?: string | null;
  external_link?: string | null;
  is_featured?: boolean;
  avg_rating?: number;
  review_count?: number;
  views_count?: number;
  user_profiles?: {
    username?: string;
    display_name?: string;
    avatar_url?: string | null;
    verified_tier?: string;
  };
};

function safeURL(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function money(value: string | number, currency: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Price on request';
  const code = /^[A-Z]{3}$/.test(currency || '') ? currency : 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

export default function MarketProductPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    if (!productId) {
      setProduct(null);
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    backendCapabilities.getMarketplaceProduct(productId)
      .then(result => {
        if (!active) return;
        if (!result?.id) throw new Error('This listing is no longer available.');
        setProduct(result as Product);
      })
      .catch(error => {
        console.error('[marketplace] product detail load failed:', error);
        if (active) setProduct(null);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId]);

  useEffect(() => {
    if (!product) return;
    const previousTitle = document.title;
    document.title = `${product.name} — Testagram Market`;
    const description = product.description?.slice(0, 155) || `Explore ${product.name} on Testagram Market.`;
    const setMeta = (name: string, value: string) => {
      let element = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!element) {
        element = document.createElement('meta');
        element.name = name;
        document.head.appendChild(element);
      }
      element.content = value;
    };
    setMeta('description', description);
    return () => { document.title = previousTitle; };
  }, [product]);

  const shareUrl = product ? `${window.location.origin}/p/${encodeURIComponent(product.id)}` : '';
  const share = async () => {
    if (!product) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: product.name, text: `Explore ${product.name} on Testagram Market`, url: shareUrl });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success('Product link copied');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy the product link');
    }
  };

  const externalURL = safeURL(product?.external_link ?? null);
  const seller = product?.user_profiles?.display_name || product?.user_profiles?.username || 'Testagram seller';
  const avatar = safeURL(product?.user_profiles?.avatar_url ?? null);
  const image = safeURL(product?.image_url ?? null);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!product) return <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center"><ShoppingBag className="w-12 h-12 text-muted-foreground/40 mb-3" /><h1 className="text-xl font-black">Product unavailable</h1><p className="text-sm text-muted-foreground mt-1">This listing may have been removed or is no longer active.</p><button onClick={() => navigate('/marketplace')} className="mt-5 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold">Back to Market</button></div>;

  return <main className="min-h-screen bg-muted/20 pb-10">
    <div className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/marketplace')} className="p-2 rounded-xl hover:bg-muted" aria-label="Back"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1"><p className="text-xs text-muted-foreground">Testagram</p><p className="font-black">Market</p></div>
        <button onClick={() => void share()} className="p-2.5 rounded-xl border border-border bg-background" aria-label="Share product"><Share2 className="w-5 h-5" /></button>
      </div>
    </div>
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <div className="grid md:grid-cols-2 gap-6 lg:gap-10">
        <div className="rounded-3xl overflow-hidden border border-border bg-background aspect-square">
          {image ? <img src={image} alt={product.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-24 h-24 text-muted-foreground/20" /></div>}
        </div>
        <section className="flex flex-col">
          <div className="flex items-center gap-2 flex-wrap">
            {product.is_featured && <span className="px-2 py-1 rounded-lg bg-primary text-primary-foreground text-[10px] font-black">FEATURED</span>}
            <span className="px-2 py-1 rounded-lg bg-muted text-[10px] font-bold capitalize">{product.category || 'other'}</span>
            <span className="text-xs text-emerald-600 font-bold">Active listing</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mt-3">{product.name}</h1>
          <p className="text-2xl font-black text-primary mt-3">{money(product.price, product.currency)}</p>
          <div className="mt-4 flex items-center gap-2">
            {avatar ? <img src={avatar} alt="" className="w-9 h-9 rounded-full object-cover" /> : <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center"><Store className="w-4 h-4 text-primary" /></div>}
            <div><p className="text-xs text-muted-foreground">Listed by</p><p className="text-sm font-bold">{seller} {product.user_profiles?.verified_tier && <BadgeCheck className="inline w-4 h-4 text-primary ml-1" />}</p>{product.user_profiles?.username && <p className="text-xs text-muted-foreground">@{product.user_profiles.username}</p>}</div>
          </div>
          {Number(product.review_count) > 0 && <p className="mt-3 text-xs text-muted-foreground">★ {Number(product.avg_rating || 0).toFixed(1)} · {product.review_count} reviews</p>}
          <div className="mt-6 rounded-2xl border border-border bg-background p-4">
            <h2 className="font-black text-sm">About this product</h2>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-2 leading-6">{product.description || 'No description provided by the seller.'}</p>
          </div>
          <div className="mt-4 rounded-xl border border-border p-3 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary mt-0.5" />
            <div><p className="text-xs font-bold">Backend-managed listing</p><p className="text-[10px] text-muted-foreground">Product details and seller identity are supplied by Testagram Backend.</p></div>
          </div>
          <div className="mt-auto pt-6 flex gap-2">
            <button onClick={() => void share()} className="px-4 py-3 rounded-xl border border-border bg-background font-bold flex items-center gap-2">{copied ? <Copy className="w-4 h-4" /> : <Share2 className="w-4 h-4" />} Share</button>
            {externalURL ? (
              <a href={externalURL} target="_blank" rel="noopener noreferrer" className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground font-black flex items-center justify-center gap-2"><ExternalLink className="w-4 h-4" /> Visit seller listing</a>
            ) : (
              <button disabled className="flex-1 py-3 rounded-xl bg-muted text-muted-foreground font-black cursor-not-allowed">In-app checkout coming soon</button>
            )}
          </div>
        </section>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Product', name: product.name,
        description: product.description || undefined, image: image ? [image] : undefined,
        sku: product.id, offers: { '@type': 'Offer', url: shareUrl, price: Number(product.price),
          priceCurrency: product.currency, availability: 'https://schema.org/InStock' }
      }) }} />
    </div>
  </main>;
}
