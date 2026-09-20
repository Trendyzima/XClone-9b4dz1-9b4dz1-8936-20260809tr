import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { TopBar } from '@/components/layout/TopBar';
import {
  Search, ShoppingBag, ShoppingCart, Heart, Home, Store, Package, Loader2,
  ArrowRight, ChevronRight, Zap, Truck, ShieldCheck, Headphones, MapPin,
  Plus, Minus, SlidersHorizontal, X, Star, BadgeCheck, Wallet, CheckCircle2,
  LockKeyhole, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';

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
  image?: string;
  username?: string;
  avatar_url?: string;
};

type Cart = Record<string, number>;
type Wallet = { balance: number; currency: string; preferred_currency?: string | null };

const CATS = [
  ['all', 'All', '🛍️'], ['electronics', 'Phones & Electronics', '📱'],
  ['fashion', 'Fashion', '👗'], ['home', 'Home & Kitchen', '🏠'],
  ['beauty', 'Beauty', '💄'], ['handmade', 'Handmade', '🧶'],
  ['art', 'Art', '🎨'], ['books', 'Books', '📚'], ['food', 'Food', '🍱'], ['other', 'More', '✨'],
] as const;

const FX_KES_PER_USD = 130;

function money(minor: number, currency: string) {
  return `${currency} ${(minor / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

function walletDebit(totalMinor: number, productCurrency: string, wallet: Wallet | null) {
  if (!wallet) return null;
  const total = totalMinor / 100;
  const wc = wallet.currency.toUpperCase();
  const pc = productCurrency.toUpperCase();
  if (wc === pc) return total;
  if (wc === 'USD' && pc === 'KES') return total / FX_KES_PER_USD;
  if (wc === 'KES' && pc === 'USD') return total * FX_KES_PER_USD;
  return null;
}

export default function ShoppingMallPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cart, setCart] = useState<Cart>(() => {
    try { return JSON.parse(localStorage.getItem('testagram-mall-cart') || '{}'); } catch { return {}; }
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [wishlist, setWishlist] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('mkt_wishlist_v2') || '[]'); } catch { return []; }
  });
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [checkoutQty, setCheckoutQty] = useState(1);
  const [paying, setPaying] = useState(false);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true); else setRefreshing(true);
    let query = supabase
      .from('products')
      .select('id,seller_id,name,description,price_minor,currency,inventory_count,category,region,is_featured,media_asset_id,created_at')
      .eq('status', 'active')
      .order('is_featured', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(80);
    if (cat !== 'all') query = query.eq('category', cat);

    const { data, error } = await query;
    if (error) {
      toast.error('Could not load the Mall');
      setProducts([]);
    } else {
      const rows = data ?? [];
      const mediaIds = rows.map(x => x.media_asset_id).filter(Boolean) as string[];
      const sellerIds = [...new Set(rows.map(x => x.seller_id))];
      const [{ data: media }, { data: profiles }] = await Promise.all([
        mediaIds.length
          ? supabase.from('media_assets').select('id,media_url').in('id', mediaIds)
          : Promise.resolve({ data: [] as any[] }),
        sellerIds.length
          ? supabase.from('profiles').select('id,username,avatar_url').in('id', sellerIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const mm = new Map((media ?? []).map(x => [x.id, x.media_url]));
      const pp = new Map((profiles ?? []).map(x => [x.id, x]));
      setProducts(rows.map(x => ({
        ...x,
        image: x.media_asset_id ? mm.get(x.media_asset_id) : undefined,
        username: pp.get(x.seller_id)?.username,
        avatar_url: pp.get(x.seller_id)?.avatar_url,
      })));
    }
    setLoading(false);
    setRefreshing(false);
  };

  const loadWallet = async () => {
    if (!user) { setWallet(null); return; }
    setWalletLoading(true);
    const { data, error } = await supabase
      .from('wallets')
      .select('balance,currency,preferred_currency')
      .eq('user_id', user.id.toString())
      .maybeSingle();
    if (error) {
      setWallet(null);
    } else {
      setWallet(data ? {
        balance: Number(data.balance ?? 0),
        currency: data.currency ?? 'USD',
        preferred_currency: data.preferred_currency,
      } : null);
    }
    setWalletLoading(false);
  };

  useEffect(() => { void load(); }, [cat]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadWallet(); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { localStorage.setItem('testagram-mall-cart', JSON.stringify(cart)); }, [cart]);
  useEffect(() => { localStorage.setItem('mkt_wishlist_v2', JSON.stringify(wishlist)); }, [wishlist]);

  const shown = useMemo(() => products.filter(p => {
    const needle = q.trim().toLowerCase();
    return (!needle ||
      p.name.toLowerCase().includes(needle) ||
      p.description?.toLowerCase().includes(needle) ||
      p.username?.toLowerCase().includes(needle))
      && (!featuredOnly || p.is_featured);
  }), [products, q, featuredOnly]);

  const cartItems = useMemo(
    () => products.filter(p => (cart[p.id] ?? 0) > 0),
    [products, cart],
  );
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);

  const changeQty = (p: Product, delta: number) => {
    setCart(current => {
      const next = Math.max(0, Math.min(p.inventory_count, (current[p.id] ?? 0) + delta));
      const copy = { ...current };
      if (next) copy[p.id] = next; else delete copy[p.id];
      return copy;
    });
  };

  const openCheckout = (product: Product, qty = 1) => {
    if (!user) { toast.error('Sign in to shop with your Testagram Wallet'); navigate('/auth'); return; }
    if (product.inventory_count < 1) { toast.error('This product is out of stock'); return; }
    setSelected(product);
    setCheckoutQty(Math.max(1, Math.min(qty, product.inventory_count)));
  };

  const pay = async () => {
    if (!user || !selected) return;
    if (checkoutQty < 1 || checkoutQty > selected.inventory_count) {
      toast.error('That quantity is no longer available');
      return;
    }
    const debit = walletDebit(selected.price_minor * checkoutQty, selected.currency, wallet);
    if (!wallet || debit === null) {
      toast.error('Your wallet currency is not supported for this product');
      return;
    }
    if (wallet.balance < debit) {
      toast.error(`Insufficient wallet balance. You need ${wallet.currency} ${debit.toFixed(2)}.`);
      return;
    }

    setPaying(true);
    const key = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${user.id}-${selected.id}-${Date.now()}`;
    const { data: orderId, error } = await supabase.rpc('place_marketplace_order', {
      p_product_id: selected.id,
      p_quantity: checkoutQty,
      p_idempotency_key: key,
    });

    if (error) {
      const message = error.message.includes('INSUFFICIENT_WALLET_BALANCE')
        ? 'Insufficient wallet balance. Deposit funds first.'
        : error.message.includes('INSUFFICIENT_STOCK')
          ? 'That quantity just sold out. Please reduce the quantity.'
          : error.message;
      toast.error(message);
      setPaying(false);
      return;
    }

    setCart(current => {
      const copy = { ...current };
      delete copy[selected.id];
      return copy;
    });
    toast.success('Payment confirmed — your order is ready to track.');
    setSelected(null);
    setPaying(false);
    await Promise.all([load(true), loadWallet()]);
    if (orderId) navigate('/orders');
  };

  const toggleWishlist = (id: string) => {
    setWishlist(current => current.includes(id)
      ? current.filter(x => x !== id)
      : [...current, id]);
  };

  return (
    <div className="min-h-screen bg-muted/20 pb-20 lg:pb-0">
      <TopBar title="Testagram Mall" />
      <div className="max-w-7xl mx-auto">
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border">
          <div className="p-3 flex gap-2 items-center">
            <button onClick={() => navigate('/')} className="p-2 rounded-xl hover:bg-muted" aria-label="Home">
              <Home className="w-4 h-4" />
            </button>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search products, brands and sellers…"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            {user && (
              <button onClick={() => navigate('/wallet')} className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-background text-xs font-bold">
                <Wallet className="w-4 h-4 text-primary" />
                {walletLoading ? 'Wallet…' : wallet ? `${wallet.currency} ${wallet.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'Wallet'}
              </button>
            )}
            <button onClick={() => setCartOpen(true)} className="relative p-2.5 rounded-xl border border-border bg-background" aria-label="Open cart">
              <ShoppingCart className="w-5 h-5" />
              {cartCount > 0 && <span className="absolute -right-1 -top-1 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center">{cartCount}</span>}
            </button>
            <button
              onClick={() => setFeaturedOnly(v => !v)}
              className={`hidden sm:flex p-2.5 rounded-xl border ${featuredOnly ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
              aria-label="Toggle hot deals"
            >
              <Zap className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-3 md:p-5 space-y-5">
          <section className="rounded-3xl overflow-hidden border border-primary/20 bg-gradient-to-r from-primary/15 via-background to-primary/5">
            <div className="p-5 md:p-8 grid md:grid-cols-[1fr_auto] gap-5 items-center">
              <div>
                <div className="flex items-center gap-2 text-primary text-xs font-black uppercase tracking-widest">
                  <Store className="w-4 h-4" /> Testagram Mall
                </div>
                <h1 className="text-3xl md:text-4xl font-black mt-2 tracking-tight">Shop. Discover. Support creators.</h1>
                <p className="text-sm md:text-base text-muted-foreground mt-2 max-w-xl">
                  A community marketplace for products from creators, local sellers and brands across Testagram.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button onClick={() => setFeaturedOnly(true)} className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center gap-2">
                    <Zap className="w-4 h-4" /> Hot deals
                  </button>
                  <button onClick={() => navigate('/products')} className="px-4 py-2.5 rounded-xl border border-border bg-background text-sm font-bold">
                    Sell on Testagram
                  </button>
                  {user && <button onClick={() => navigate('/orders')} className="px-4 py-2.5 rounded-xl border border-border bg-background text-sm font-bold">My orders</button>}
                </div>
              </div>
              <div className="hidden md:flex w-40 h-40 rounded-3xl bg-primary/10 items-center justify-center">
                <ShoppingBag className="w-20 h-20 text-primary" />
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              [Truck, 'Local delivery', 'Seller-set delivery'],
              [ShieldCheck, 'Wallet checkout', 'Atomic payment'],
              [BadgeCheck, 'Trusted sellers', 'Community profiles'],
              [Headphones, 'Help & support', 'Get assistance'],
            ].map(([Icon, title, sub]) => (
              <div key={String(title)} className="rounded-2xl border border-border bg-background p-3 flex gap-2 items-center">
                <Icon className="w-5 h-5 text-primary shrink-0" />
                <div><p className="text-xs font-bold">{String(title)}</p><p className="text-[10px] text-muted-foreground">{String(sub)}</p></div>
              </div>
            ))}
          </section>

          {user && (
            <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex flex-wrap items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-background flex items-center justify-center"><Wallet className="w-5 h-5 text-primary" /></div>
              <div className="flex-1 min-w-[180px]">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Testagram Wallet</p>
                <p className="text-lg font-black">
                  {walletLoading ? 'Loading balance…' : wallet ? `${wallet.currency} ${wallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Wallet not provisioned'}
                </p>
              </div>
              <button onClick={() => navigate('/wallet')} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold">Add funds</button>
              <button onClick={() => { void loadWallet(); }} className="p-2 rounded-xl border border-border bg-background" aria-label="Refresh wallet">
                <RefreshCw className={`w-4 h-4 ${walletLoading ? 'animate-spin' : ''}`} />
              </button>
            </section>
          )}

          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-black">Shop by category</h2>
              <button onClick={() => { setCat('all'); setFeaturedOnly(false); }} className="text-xs font-bold text-primary">View all</button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {CATS.map(([id, label, emoji]) => (
                <button
                  key={id}
                  onClick={() => { setCat(id); setFeaturedOnly(false); }}
                  className={`min-w-[82px] sm:min-w-[105px] rounded-2xl border p-2.5 bg-background hover:border-primary/40 ${cat === id && !featuredOnly ? 'border-primary ring-1 ring-primary/20' : 'border-border'}`}
                >
                  <div className="w-9 h-9 mx-auto rounded-full bg-muted flex items-center justify-center text-lg">{emoji}</div>
                  <p className="text-[10px] font-bold mt-1.5 truncate">{label}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-background overflow-hidden">
            <div className="p-3 flex items-center justify-between border-b border-border">
              <div>
                <h2 className="font-black flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> Daily deals</h2>
                <p className="text-[10px] text-muted-foreground">Featured community picks and fresh listings</p>
              </div>
              <div className="flex items-center gap-2">
                {refreshing && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                <button onClick={() => setFeaturedOnly(v => !v)} className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${featuredOnly ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  <SlidersHorizontal className="w-3.5 h-3.5" /> {featuredOnly ? 'Showing featured' : 'Filter'}
                </button>
              </div>
            </div>

            {loading ? (
              <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
            ) : shown.length ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-border">
                {shown.map(p => {
                  const wished = wishlist.includes(p.id);
                  return (
                    <article key={p.id} className="bg-background group min-w-0">
                      <button onClick={() => openCheckout(p)} className="block w-full text-left">
                        <div className="relative aspect-square bg-muted overflow-hidden">
                          {p.image
                            ? <img src={p.image} alt={p.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                            : <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-10 h-10 text-muted-foreground/30" /></div>}
                          {p.is_featured && <span className="absolute top-2 left-2 px-1.5 py-1 rounded-md bg-primary text-primary-foreground text-[9px] font-black">HOT</span>}
                          {p.inventory_count > 0 && p.inventory_count <= 5 && <span className="absolute bottom-2 left-2 px-1.5 py-1 rounded-md bg-background/90 text-[9px] font-bold">Only {p.inventory_count} left</span>}
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); toggleWishlist(p.id); }}
                            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-background/90 flex items-center justify-center shadow-sm"
                            aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'}
                          >
                            <Heart className={`w-4 h-4 ${wished ? 'fill-red-500 text-red-500' : 'text-muted-foreground'}`} />
                          </button>
                        </div>
                        <div className="p-2.5">
                          <h3 className="font-semibold text-xs leading-4 line-clamp-2 min-h-8">{p.name}</h3>
                          <div className="flex items-center gap-1 mt-1">
                            <Star className="w-3 h-3 fill-current text-amber-500" />
                            <span className="text-[10px] font-bold">New</span>
                            <span className="text-[10px] text-muted-foreground">· @{p.username ?? 'seller'}</span>
                          </div>
                          <p className="text-sm font-black text-primary mt-1">{money(p.price_minor, p.currency)}</p>
                          {p.region && <p className="text-[9px] text-muted-foreground flex items-center gap-1 mt-1"><MapPin className="w-2.5 h-2.5" />{p.region}</p>}
                        </div>
                      </button>
                      <div className="px-2.5 pb-2.5 flex gap-1.5">
                        <button onClick={() => changeQty(p, 1)} disabled={p.inventory_count < 1} className="flex-1 py-2 rounded-lg border border-border text-[10px] font-bold hover:bg-muted disabled:opacity-40">Add to cart</button>
                        <button onClick={() => openCheckout(p)} disabled={p.inventory_count < 1} className="px-2.5 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-40" aria-label={`Buy ${p.name}`}>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-16 text-muted-foreground">
                <ShoppingBag className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="font-bold">No products found</p>
                <p className="text-xs mt-1">Try another category or search term.</p>
                <button onClick={() => { setQ(''); setCat('all'); setFeaturedOnly(false); }} className="text-primary text-xs font-bold mt-2">Clear filters</button>
              </div>
            )}
          </section>

          <section className="grid sm:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-border bg-background p-4"><Truck className="w-5 h-5 text-primary" /><h3 className="font-bold text-sm mt-2">Delivery made clear</h3><p className="text-xs text-muted-foreground mt-1">See the seller's region before you order and keep delivery expectations transparent.</p></div>
            <div className="rounded-2xl border border-border bg-background p-4"><ShieldCheck className="w-5 h-5 text-primary" /><h3 className="font-bold text-sm mt-2">Secure orders</h3><p className="text-xs text-muted-foreground mt-1">Wallet payments and stock updates happen in one protected database transaction.</p></div>
            <div className="rounded-2xl border border-border bg-background p-4"><Package className="w-5 h-5 text-primary" /><h3 className="font-bold text-sm mt-2">Track your purchases</h3><button onClick={() => navigate('/orders')} className="text-primary text-xs font-bold mt-2 flex items-center gap-1">Open orders <ChevronRight className="w-3 h-3" /></button></div>
          </section>
        </div>
      </div>

      {cartOpen && (
        <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setCartOpen(false)}>
          <aside onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full max-w-md bg-background shadow-2xl flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div><h2 className="font-black text-lg">Your cart</h2><p className="text-xs text-muted-foreground">{cartCount} item{cartCount === 1 ? '' : 's'}</p></div>
              <button onClick={() => setCartOpen(false)} className="p-2 rounded-xl hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!cartItems.length ? (
                <div className="py-16 text-center text-muted-foreground"><ShoppingCart className="w-10 h-10 mx-auto opacity-30" /><p className="font-bold mt-2">Your cart is empty</p></div>
              ) : cartItems.map(p => (
                <div key={p.id} className="flex gap-3 border border-border rounded-2xl p-3">
                  <div className="w-16 h-16 rounded-xl bg-muted overflow-hidden shrink-0">{p.image && <img src={p.image} alt="" className="w-full h-full object-cover" />}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm line-clamp-2">{p.name}</p>
                    <p className="text-primary font-black text-sm mt-0.5">{money(p.price_minor * (cart[p.id] ?? 0), p.currency)}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => changeQty(p, -1)} className="p-1 rounded-md border"><Minus className="w-3 h-3" /></button>
                      <span className="text-xs font-bold">{cart[p.id]}</span>
                      <button onClick={() => changeQty(p, 1)} className="p-1 rounded-md border"><Plus className="w-3 h-3" /></button>
                      <button onClick={() => openCheckout(p, cart[p.id] ?? 1)} className="ml-auto text-[10px] bg-primary text-primary-foreground px-2.5 py-1.5 rounded-lg font-bold">Checkout</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {cartItems.length > 0 && (
              <div className="p-4 border-t border-border">
                <p className="text-[10px] text-muted-foreground">Checkout is completed per product so each seller's inventory and wallet settlement remain atomic.</p>
              </div>
            )}
          </aside>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-3" onClick={() => !paying && setSelected(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-lg bg-background rounded-3xl border border-border shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div><p className="text-[10px] font-black uppercase tracking-widest text-primary">Secure checkout</p><h2 className="font-black text-lg">Confirm your order</h2></div>
              <button onClick={() => !paying && setSelected(null)} className="p-2 rounded-xl hover:bg-muted" disabled={paying}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex gap-3">
                <div className="w-20 h-20 rounded-2xl bg-muted overflow-hidden shrink-0">{selected.image && <img src={selected.image} alt="" className="w-full h-full object-cover" />}</div>
                <div className="min-w-0">
                  <h3 className="font-bold line-clamp-2">{selected.name}</h3>
                  <button onClick={() => navigate(`/profile/${selected.username}`)} className="text-xs text-primary font-semibold mt-1">@{selected.username ?? 'seller'}</button>
                  <p className="text-sm text-muted-foreground mt-1">{selected.region || 'Seller-set delivery'}</p>
                </div>
              </div>

              {selected.description && <p className="text-sm text-muted-foreground border-y border-border py-3 line-clamp-4">{selected.description}</p>}

              <div className="flex items-center justify-between rounded-2xl bg-muted/40 p-3">
                <div><p className="text-xs font-bold">Quantity</p><p className="text-[10px] text-muted-foreground">{selected.inventory_count} available</p></div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setCheckoutQty(v => Math.max(1, v - 1))} className="w-9 h-9 rounded-xl border bg-background"><Minus className="w-4 h-4 mx-auto" /></button>
                  <span className="font-black">{checkoutQty}</span>
                  <button onClick={() => setCheckoutQty(v => Math.min(selected.inventory_count, v + 1))} className="w-9 h-9 rounded-xl border bg-background"><Plus className="w-4 h-4 mx-auto" /></button>
                </div>
              </div>

              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center gap-2"><Wallet className="w-5 h-5 text-primary" /><div><p className="text-xs font-black">Pay with Testagram Wallet</p><p className="text-[10px] text-muted-foreground">Atomic debit + seller credit</p></div></div>
                {walletLoading ? <p className="text-sm mt-3 text-muted-foreground">Loading wallet…</p> : wallet ? (
                  <>
                    <div className="flex justify-between items-end mt-3">
                      <div><p className="text-[10px] text-muted-foreground">Wallet balance</p><p className="font-black">{wallet.currency} {wallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div>
                      <button onClick={() => navigate('/wallet')} className="text-xs text-primary font-bold">Add funds</button>
                    </div>
                    <div className="flex justify-between items-end mt-3 pt-3 border-t border-border">
                      <div><p className="text-[10px] text-muted-foreground">Order total</p><p className="text-xl font-black">{money(selected.price_minor * checkoutQty, selected.currency)}</p></div>
                      {walletDebit(selected.price_minor * checkoutQty, selected.currency, wallet) !== null && (
                        <div className="text-right"><p className="text-[10px] text-muted-foreground">Wallet debit</p><p className="font-black text-primary">{wallet.currency} {walletDebit(selected.price_minor * checkoutQty, selected.currency, wallet)!.toFixed(2)}</p></div>
                      )}
                    </div>
                  </>
                ) : <button onClick={() => navigate('/wallet')} className="mt-3 text-xs text-primary font-bold">Open wallet to provision it →</button>}
              </div>

              <div className="flex items-start gap-2 text-[10px] text-muted-foreground">
                <LockKeyhole className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>Payment is handled by the Testagram Wallet transaction and the order is created only when payment, seller credit and inventory reservation all succeed together.</span>
              </div>

              <button
                onClick={() => void pay()}
                disabled={paying || !wallet || walletDebit(selected.price_minor * checkoutQty, selected.currency, wallet) === null}
                className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-black flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {paying ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                {paying ? 'Processing payment…' : 'Pay securely from wallet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
