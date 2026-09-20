import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, CheckCircle2, Copy, Heart, Loader2, MapPin, Share2, ShoppingBag, ShieldCheck, Star, Store, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

type Product = {
  id: string;
  seller_id: string;
  name: string;
  description: string | null;
  price_minor: number;
  currency: string;
  inventory_count: number;
  category: string;
  region: string;
  is_featured: boolean;
  media_asset_id: string | null;
  created_at: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  verified: boolean;
  verified_tier: string | null;
  creator_tier: string | null;
  is_creator: boolean;
  image?: string;
};

function money(minor: number, currency: string) {
  return `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MarketProductPage() {
  const { productId } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [copied, setCopied] = useState(false);

  const refCode = searchParams.get('ref')?.slice(0, 120) || null;
  const source = searchParams.get('utm_source')?.slice(0, 80) || null;
  const medium = searchParams.get('utm_medium')?.slice(0, 80) || null;
  const campaign = searchParams.get('utm_campaign')?.slice(0, 120) || null;

  const sessionId = useMemo(() => {
    try {
      const key = 'testagram-market-session';
      const existing = localStorage.getItem(key);
      if (existing) return existing;
      const next = crypto.randomUUID();
      localStorage.setItem(key, next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!productId) return;
      setLoading(true);
      const { data, error } = await supabase.rpc('get_marketplace_product', { p_product_id: productId });
      if (cancelled) return;
      if (error || !data?.length) {
        setProduct(null);
        setLoading(false);
        return;
      }
      const row = data[0] as Product;
      let image: string | undefined;
      if (row.media_asset_id) {
        const media = await supabase.from('media_assets').select('id,media_url').eq('id', row.media_asset_id).maybeSingle();
        image = (media.data as { media_url?: string | null } | null)?.media_url ?? undefined;
      }
      if (cancelled) return;
      setProduct({ ...row, price_minor: Number(row.price_minor), inventory_count: Number(row.inventory_count), image });
      setLoading(false);
      await supabase.rpc('record_marketplace_event', {
        p_product_id: row.id,
        p_event_type: 'product_view',
        p_ref_code: refCode,
        p_source: source,
        p_medium: medium,
        p_campaign: campaign,
        p_session_id: sessionId,
      });
      document.title = `${row.name} — Testagram Market`;
      const description = row.description?.slice(0, 155) || `Shop ${row.name} on Testagram Market.`;
      const canonical = `https://testagram.market/p/${row.id}`;
      const setMeta = (name: string, content: string) => {
        let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
        if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
        el.content = content;
      };
      const setOg = (property: string, content: string) => {
        let el = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
        if (!el) { el = document.createElement('meta'); el.setAttribute('property', property); document.head.appendChild(el); }
        el.content = content;
      };
      setMeta('description', description);
      setOg('og:type', 'product');
      setOg('og:url', canonical);
      setOg('og:title', `${row.name} — Testagram Market`);
      setOg('og:description', description);
      if (image) setOg('og:image', image);
      setOg('og:site_name', 'Testagram Market');
      return () => {
        document.title = 'Testagram';
        setMeta('description', 'Testagram Market');
      };
    };
    void load();
    return () => { cancelled = true; };
  }, [productId, refCode, source, medium, campaign, sessionId]);

  const shareUrl = product ? `https://testagram.market/p/${product.id}?ref=${encodeURIComponent(user?.user_metadata?.username || product.username || product.seller_id)}&utm_source=share&utm_medium=product&utm_campaign=market` : '';

  const share = async () => {
    if (!product) return;
    await supabase.rpc('record_marketplace_event', {
      p_product_id: product.id,
      p_event_type: 'share_click',
      p_ref_code: user?.user_metadata?.username || product.username || null,
      p_source: 'share',
      p_medium: 'product',
      p_campaign: 'market',
      p_session_id: sessionId,
    });
    if (navigator.share) {
      try { await navigator.share({ title: product.name, text: `Shop ${product.name} on Testagram Market`, url: shareUrl }); return; } catch {}
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success('Product link copied');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy the product link');
    }
  };

  const buy = async () => {
    if (!product) return;
    if (!user) { navigate('/auth'); return; }
    if (product.inventory_count < 1) { toast.error('This product is out of stock'); return; }
    setBuying(true);
    await supabase.rpc('record_marketplace_event', {
      p_product_id: product.id,
      p_event_type: 'checkout_start',
      p_ref_code: refCode,
      p_source: source,
      p_medium: medium,
      p_campaign: campaign,
      p_session_id: sessionId,
    });
    setBuying(false);
    navigate('/shop', { state: { productId: product.id, openCheckout: true } });
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!product) return <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center"><ShoppingBag className="w-12 h-12 text-muted-foreground/40 mb-3" /><h1 className="text-xl font-black">Product unavailable</h1><p className="text-sm text-muted-foreground mt-1">This listing may have sold out or been removed.</p><button onClick={() => navigate('/shop')} className="mt-5 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold">Back to Market</button></div>;

  const availability = product.inventory_count <= 5 ? `Only ${product.inventory_count} left` : 'In stock';

  return <main className="min-h-screen bg-muted/20 pb-10">
    <div className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/shop')} className="p-2 rounded-xl hover:bg-muted" aria-label="Back"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1"><p className="text-xs text-muted-foreground">Testagram</p><p className="font-black">Market</p></div>
        <button onClick={share} className="p-2.5 rounded-xl border border-border bg-background" aria-label="Share product"><Share2 className="w-5 h-5" /></button>
      </div>
    </div>
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <div className="grid md:grid-cols-2 gap-6 lg:gap-10">
        <div className="rounded-3xl overflow-hidden border border-border bg-background aspect-square">
          {product.image ? <img src={product.image} alt={product.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-24 h-24 text-muted-foreground/20" /></div>}
        </div>
        <section className="flex flex-col">
          <div className="flex items-center gap-2 flex-wrap">
            {product.is_featured && <span className="px-2 py-1 rounded-lg bg-primary text-primary-foreground text-[10px] font-black">FEATURED</span>}
            <span className="px-2 py-1 rounded-lg bg-muted text-[10px] font-bold">{product.category}</span>
            <span className="text-xs text-emerald-600 font-bold">{availability}</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mt-3">{product.name}</h1>
          <p className="text-2xl font-black text-primary mt-3">{money(product.price_minor, product.currency)}</p>
          <div className="mt-4 flex items-center gap-2">
            {product.avatar_url ? <img src={product.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" /> : <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center"><Store className="w-4 h-4 text-primary" /></div>}
            <div><p className="text-xs text-muted-foreground">Sold by</p><p className="text-sm font-bold">@{product.username || 'seller'} {product.verified && <BadgeCheck className="inline w-4 h-4 text-primary ml-1" />}</p></div>
          </div>
          {product.region && <p className="mt-4 text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{product.region}</p>}
          <div className="mt-6 rounded-2xl border border-border bg-background p-4">
            <h2 className="font-black text-sm">About this product</h2>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-2 leading-6">{product.description || 'No description provided by the seller.'}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="rounded-xl border border-border p-3"><ShieldCheck className="w-4 h-4 text-primary" /><p className="text-xs font-bold mt-1">Wallet protected</p><p className="text-[10px] text-muted-foreground">Atomic checkout</p></div>
            <div className="rounded-xl border border-border p-3"><CheckCircle2 className="w-4 h-4 text-emerald-600" /><p className="text-xs font-bold mt-1">Trackable order</p><p className="text-[10px] text-muted-foreground">View in Orders</p></div>
          </div>
          <div className="mt-auto pt-6 flex gap-2">
            <button onClick={share} className="px-4 py-3 rounded-xl border border-border bg-background font-bold flex items-center gap-2">{copied ? <Copy className="w-4 h-4" /> : <Share2 className="w-4 h-4" />} Share</button>
            <button onClick={buy} disabled={buying || product.inventory_count < 1} className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground font-black flex items-center justify-center gap-2 disabled:opacity-50">{buying ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Wallet className="w-4 h-4" /> Buy securely</>}</button>
          </div>
        </section>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Product', name: product.name,
        description: product.description || undefined, image: product.image ? [product.image] : undefined,
        sku: product.id, offers: { '@type': 'Offer', url: `https://testagram.market/p/${product.id}`, price: product.price_minor / 100,
          priceCurrency: product.currency, availability: product.inventory_count > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' }
      }) }} />
    </div>
  </main>;
}
