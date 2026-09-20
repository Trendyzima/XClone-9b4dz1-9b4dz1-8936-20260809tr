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

type MarketplaceRow = Omit<Product, 'image' | 'username' | 'avatar_url' | 'price_minor' | 'inventory_count'> & {
  price_minor: number | string;
  inventory_count: number | string;
  username: string | null;
  avatar_url: string | null;
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

    const { data, error } = await supabase.rpc('get_marketplace_products', {
      p_category: cat,
      p_search: q.trim() || null,
      p_region: null,
      p_limit: 80,
      p_offset: 0,
    });

    if (error) {
      toast.error('Could not load the Mall');
      setProducts([]);
    } else {
      const rows = (data ?? []) as unknown as MarketplaceRow[];
      const mediaIds = rows.map(x => x.media_asset_id).filter(Boolean) as string[];
      const { data: media } = mediaIds.length
        ? await supabase.from('media_assets').select('id,media_url').in('id', mediaIds)
        : { data: [] as Array<{ id: string; media_url: string | null }> };

      const mm = new Map((media ?? []).map(x => [x.id, x.media_url]));
      setProducts(rows.map(x => ({
        id: x.id,
        seller_id: x.seller_id,
        name: x.name,
        description: x.description,
        price_minor: Number(x.price_minor),
        currency: x.currency,
        inventory_count: Number(x.inventory_count),
        category: x.category,
        region: x.region,
        is_featured: x.is_featured,
        media_asset_id: x.media_asset_id,
        created_at: x.created_at,
        image: x.media_asset_id ? mm.get(x.media_asset_id) ?? undefined : undefined,
        username: x.username ?? undefined,
        avatar_url: x.avatar_url ?? undefined,
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