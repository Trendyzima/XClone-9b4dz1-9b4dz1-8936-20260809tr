
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import {
  ShoppingBag, Star, BadgeCheck, MapPin, ExternalLink, Heart,
  Loader2, Package, TrendingUp, Users, Eye, MessageSquare,
  Megaphone, X, Check, Share2, Copy,
  ShoppingCart, Truck, CheckCircle2, Clock, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

// ── Module-level label helpers (esbuild-safe) ──────────────────────────────
const CAT_MAP: Record<string, string> = {
  digital: '💻 Digital', handmade: '🧵 Handmade', fashion: '👗 Fashion',
  art: '🎨 Art', food: '🍜 Food', electronics: '📱 Electronics',
  books: '📚 Books', beauty: '💄 Beauty', home: '🏠 Home',
  sports: '⚽ Sports', music: '🎵 Music', toys: '🧸 Toys', other: '📦 Other',
};

const REGION_MAP: Record<string, string> = {
  kenya: '🇰🇪 Kenya', nigeria: '🇳🇬 Nigeria', ghana: '🇬🇭 Ghana',
  south_africa: '🇿🇦 South Africa', us: '🇺🇸 United States',
  uk: '🇬🇧 United Kingdom', europe: '🇪🇺 Europe', asia: '🌏 Asia',
  all: '🌍 Worldwide',
};

function catLabel(id: string) { return CAT_MAP[id] ?? '📦 Other'; }
function regionLabel(id: string) { return REGION_MAP[id] ?? '🌍 Worldwide'; }

// ── Star Row ──────────────────────────────────────────────────────────────
function StarRow({ rating, count }: { rating: number; count: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`w-3 h-3 ${i <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30'}`} />
      ))}
      {count > 0 && <span className="text-[10px] text-muted-foreground ml-0.5">({count})</span>}
    </div>
  );
}

// ── Status config (esbuild-safe: module-level) ────────────────────────────
const ORDER_STATUS_CLS: Record<string, string> = {
  confirmed: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  shipped:   'bg-amber-500/10 text-amber-600 border-amber-500/20',
  delivered: 'bg-green-500/10 text-green-600 border-green-500/20',
  cancelled: 'bg-red-500/10 text-red-500 border-red-500/20',
};

// ── Boost Product Dialog ─────────────────────────────────────────────────
function BoostDialog({ product, onClose }: { product: any; onClose: () => void }) {
  const { user } = useAuth();
  const [budget, setBudget] = useState('');
  const [days, setDays] = useState('7');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const BUDGET_OPTIONS = ['5', '10', '25', '50', '100'];
  const DAY_OPTIONS = ['3', '7', '14', '30'];

  const handleBoost = async () => {
    if (!user) { toast.error('Sign in to boost'); return; }
    const budgetNum = Number(budget);
    if (!budgetNum || budgetNum < 1) { toast.error('Enter a valid budget'); return; }
    setSubmitting(true);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + Number(days) * 86400000);
    const { error } = await supabase.from('user_ads').insert({
      user_id: user.id,
      title: product.name,
      description: product.description || `Shop ${product.name} on Testagram Marketplace`,
      image_url: product.image_url ?? null,
      target_url: product.external_link || `${window.location.origin}/marketplace`,
      budget: budgetNum,
      status: 'pending',
      payment_status: 'pending',
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      is_story_format: false,
      target_audience: { source: 'product_boost', product_id: product.id, category: product.category ?? 'other' },
    });
    if (error) { toast.error(error.message); setSubmitting(false); return; }
    setDone(true);
    setSubmitting(false);
    setTimeout(onClose, 2000);
  };

  return (
    <div className="fixed inset-0 z-[400] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {done ? (
          <div className="text-center py-10 px-6 space-y-3">
            <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
              <Check className="w-7 h-7 text-green-500" />
            </div>
            <h3 className="font-black text-lg">Ad Submitted!</h3>
            <p className="text-sm text-muted-foreground">Your product will be reviewed and start reaching buyers in feeds soon.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="font-bold text-base">Promote to Feed</h3>
                <p className="text-xs text-muted-foreground line-clamp-1">{product.name}</p>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-5">
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-muted/40 border border-border">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="w-14 h-14 rounded-xl object-cover shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center shrink-0">
                    <ShoppingBag className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">{product.name}</p>
                  <p className="text-lg font-black text-primary">${Number(product.price).toFixed(2)}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Budget</p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {BUDGET_OPTIONS.map(b => (
                    <button key={b} onClick={() => setBudget(b)}
                      className={`px-3 py-1.5 rounded-xl border text-sm font-bold transition-all ${
                        budget === b ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'
                      }`}>${b}</button>
                  ))}
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
                  <input type="number" min="1" value={budget} onChange={e => setBudget(e.target.value)}
                    placeholder="Custom amount"
                    className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Duration</p>
                <div className="flex gap-2">
                  {DAY_OPTIONS.map(d => (
                    <button key={d} onClick={() => setDays(d)}
                      className={`flex-1 py-2 rounded-xl border text-sm font-bold transition-all ${
                        days === d ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'
                      }`}>{d}d</button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/[0.08] border border-blue-500/20 rounded-xl">
                <Megaphone className="w-4 h-4 text-blue-500 shrink-0" />
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  Your product ad will be reviewed and organically distributed across feeds, stories, and relevant sections via our ad algorithm.
                </p>
              </div>

              <button onClick={handleBoost} disabled={submitting || !budget}
                className="w-full py-3.5 bg-primary text-primary-foreground rounded-2xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Megaphone className="w-5 h-5" />}
                {submitting ? 'Submitting…' : `Boost for $${budget || '—'} · ${days} days`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Storefront Product Card ────────────────────────────────────────────────
function StorefrontCard({
  product, wishlisted, onWishlist, onBoost, isOwner,
}: {
  product: any; wishlisted: boolean; onWishlist: () => void; onBoost: () => void; isOwner: boolean;
}) {
  return (
    <div className="rounded-2xl overflow-hidden border border-border bg-card hover:shadow-lg hover:-translate-y-0.5 transition-all group">
      <div className="relative w-full aspect-square bg-muted overflow-hidden">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ShoppingBag className="w-10 h-10 text-muted-foreground/30" />
          </div>
        )}
        <button onClick={e => { e.stopPropagation(); onWishlist(); }}
          className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
            wishlisted ? 'bg-red-500 text-white' : 'bg-black/40 text-white hover:bg-red-500'
          }`}>
          <Heart className={`w-3.5 h-3.5 ${wishlisted ? 'fill-white' : ''}`} />
        </button>
        {product.is_featured && (
          <div className="absolute top-2 left-2 flex items-center gap-0.5 px-1.5 py-0.5 bg-yellow-400/90 text-yellow-900 rounded-full text-[9px] font-bold">
            <Star className="w-2 h-2 fill-current" /> Featured
          </div>
        )}
        {product.stock === 0 && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <span className="px-3 py-1 bg-black/70 text-white rounded-full text-xs font-bold">Sold Out</span>
          </div>
        )}
      </div>
      <div className="p-3 space-y-1">
        <p className="font-semibold text-sm leading-tight line-clamp-2">{product.name}</p>
        <p className="text-base font-black text-primary">${Number(product.price).toFixed(2)}</p>
        {product.avg_rating > 0 && <StarRow rating={product.avg_rating} count={product.review_count ?? 0} />}
        {product.category && product.category !== 'other' && (
          <p className="text-[10px] text-muted-foreground">{catLabel(product.category)}</p>
        )}
        <div className="flex gap-1.5 mt-2">
          {product.external_link ? (
            <a href={product.external_link} target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold rounded-lg transition-colors"
              onClick={e => e.stopPropagation()}>
              Buy <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <div className="flex-1 flex items-center justify-center py-1.5 text-muted-foreground text-[10px]">
              <MessageSquare className="w-3 h-3 mr-1" />Contact seller
            </div>
          )}
          {isOwner && (
            <button onClick={e => { e.stopPropagation(); onBoost(); }}
              className="flex items-center justify-center gap-1 px-2 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 text-xs font-bold rounded-lg transition-colors"
              title="Promote to feed">
              <Megaphone className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function SellerStorefrontPage() {
  const { username } = useParams<{ username: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null as any);
  const [products, setProducts] = useState([] as any[]);
  const [loading, setLoading] = useState(true);
  const [wishlistIds, setWishlistIds] = useState([] as string[]);
  const [boostProduct, setBoostProduct] = useState(null as any);
  const [shareCopied, setShareCopied] = useState(false);
  const [activeTab, setActiveTab] = useState('products' as 'products' | 'orders');
  const [orders, setOrders] = useState([] as any[]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState(null as string | null);

  const totalSales   = products.reduce((s, p) => s + (p.sales_count ?? 0), 0);
  const avgRating    = products.length ? products.reduce((s, p) => s + Number(p.avg_rating ?? 0), 0) / products.length : 0;
  const totalReviews = products.reduce((s, p) => s + (p.review_count ?? 0), 0);
  const totalViews   = products.reduce((s, p) => s + (p.views_count ?? 0), 0);
  const isOwner      = user?.id === profile?.id;

  useSEO({
    title: username ? `${username}'s Store — Testagram Marketplace` : 'Seller Store',
    description: `Browse products from ${username} on Testagram Marketplace.`,
    url: `/seller/${username}`,
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem('mkt_wishlist_v2');
      if (raw) setWishlistIds(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
  }, []);

  const isWishlisted = (id: string) => wishlistIds.includes(id);
  const toggleWishlist = (id: string) => {
    setWishlistIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      try { localStorage.setItem('mkt_wishlist_v2', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/seller/${profile?.username}`;
    const ratingStr = avgRating > 0 ? ` | ★ ${avgRating.toFixed(1)}` : '';
    const text = `Check out @${profile?.username}'s store on Testagram Marketplace — ${products.length} product${products.length !== 1 ? 's' : ''}${ratingStr}`;
    if (navigator.share) {
      try { await navigator.share({ title: `@${profile?.username}'s Store`, text, url }); return; } catch { /* fallback */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      toast.success('Store link copied!');
      setTimeout(() => setShareCopied(false), 2000);
    } catch { toast.error('Could not copy link'); }
  };

  const fetchOrders = async (sellerId: string) => {
    setLoadingOrders(true);
    const { data } = await supabase
      .from('orders')
      .select('*, products(id, name, image_url), buyer:buyer_id(id, username, avatar_url, verified)')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });
    setOrders(data ?? []);
    setLoadingOrders(false);
  };

  const handleOrderStatus = async (orderId: string, newStatus: string) => {
    setUpdatingOrderId(orderId);
    await supabase.from('orders').update({
      status: newStatus,
      ...(newStatus === 'shipped'   ? { shipped_at:   new Date().toISOString() } : {}),
      ...(newStatus === 'delivered' ? { delivered_at: new Date().toISOString() } : {}),
    }).eq('id', orderId);
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
    toast.success('Order status updated');
    setUpdatingOrderId(null);
  };

  const handleDMBuyer = async (buyerId: string) => {
    if (!user || !profile) return;
    const { data: existing } = await supabase
      .from('conversations').select('id')
      .or(`and(participant_1.eq.${profile.id},participant_2.eq.${buyerId}),and(participant_1.eq.${buyerId},participant_2.eq.${profile.id})`)
      .maybeSingle();
    if (existing?.id) { navigate(`/messages?conv=${existing.id}`); return; }
    const { data: conv } = await supabase.from('conversations')
      .insert({ participant_1: profile.id, participant_2: buyerId }).select('id').single();
    if (conv?.id) navigate(`/messages?conv=${conv.id}`);
  };

  useEffect(() => { if (username) fetchStorefront(); }, [username]);

  const fetchStorefront = async () => {
    setLoading(true);
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, bio, verified, follower_count, is_creator, cover_image, website, location, total_earnings')
      .eq('username', username)
      .maybeSingle();
    if (!profileData) { setLoading(false); return; }
    setProfile(profileData);
    if (user?.id === profileData.id) fetchOrders(profileData.id);
    const { data: productsData } = await supabase
      .from('products')
      .select('*')
      .eq('user_id', profileData.id)
      .eq('is_active', true)
      .order('is_featured', { ascending: false })
      .order('views_count', { ascending: false })
      .limit(60);
    setProducts(productsData ?? []);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title="Store" showBack />
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
          <ShoppingBag className="w-16 h-16 opacity-20" />
          <p className="font-bold text-lg">Seller not found</p>
          <button onClick={() => navigate('/marketplace')} className="px-5 py-2.5 bg-primary text-primary-foreground rounded-full font-semibold text-sm">
            Browse Marketplace
          </button>
        </div>
      </div>
    );
  }

  const pendingOrderCount  = orders.filter(o => o.status === 'confirmed').length;
  const deliveredOrderCount = orders.filter(o => o.status === 'delivered').length;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title={`@${profile.username}'s Store`} showBack />

      {/* ── Hero Cover ── */}
      <div className="w-full h-40 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent overflow-hidden">
        {profile.cover_image && (
          <img src={profile.cover_image} alt="" className="w-full h-full object-cover opacity-60" />
        )}
      </div>

      {/* ── Profile Info ── */}
      <div className="px-4 pb-4 -mt-12">
        <div className="flex items-end justify-between gap-4 mb-3">
          <div className="w-20 h-20 rounded-2xl border-4 border-background bg-muted overflow-hidden shadow-xl">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt={profile.username} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center font-black text-2xl text-muted-foreground">
                {profile.username?.[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex gap-2 pb-1">
            <button
              onClick={handleShare}
              className={`flex items-center gap-1.5 px-3 py-2 border rounded-full text-xs font-semibold transition-colors ${
                shareCopied ? 'border-green-500/30 text-green-600 bg-green-500/5' : 'border-border hover:bg-muted'
              }`}
              title="Share storefront">
              {shareCopied ? <Copy className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
              {shareCopied ? 'Copied!' : 'Share'}
            </button>
            <button
              onClick={() => navigate(`/profile/${profile.username}`)}
              className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-full text-xs font-semibold hover:bg-muted transition-colors">
              <Users className="w-3.5 h-3.5" /> Profile
            </button>
            {isOwner && (
              <button
                onClick={() => navigate('/products')}
                className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-full text-xs font-semibold hover:opacity-90 transition-opacity">
                <Package className="w-3.5 h-3.5" /> Manage
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-black">@{profile.username}</h1>
          {profile.verified && <BadgeCheck className="w-5 h-5 text-primary" />}
          {profile.is_creator && (
            <span className="px-2 py-0.5 bg-amber-500/10 text-amber-600 rounded-full text-[10px] font-bold border border-amber-500/20">
              Creator
            </span>
          )}
        </div>

        {profile.bio && (
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">{profile.bio}</p>
        )}

        {(profile.location || profile.website) && (
          <div className="flex flex-wrap gap-3 mb-3">
            {profile.location && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="w-3.5 h-3.5" />{profile.location}
              </span>
            )}
            {profile.website && (
              <a href={profile.website} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="w-3.5 h-3.5" />{profile.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        )}
      </div>

      {/* ── Tabs (owner only: Products | Orders) ── */}
      {isOwner && (
        <div className="flex border-b border-border bg-background">
          <button
            onClick={() => setActiveTab('products')}
            className={`flex-1 py-3 text-sm font-semibold border-b-2 flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'products' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'
            }`}>
            <Package className="w-4 h-4" /> Products
            <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-bold">{products.length}</span>
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className={`flex-1 py-3 text-sm font-semibold border-b-2 flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'orders' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'
            }`}>
            <ShoppingCart className="w-4 h-4" /> Orders
            {pendingOrderCount > 0 ? (
              <span className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded-full font-bold">
                {pendingOrderCount} new
              </span>
            ) : orders.length > 0 ? (
              <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-bold">{orders.length}</span>
            ) : null}
          </button>
        </div>
      )}

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-4 gap-0 border-y border-border bg-muted/20 divide-x divide-border">
        <div className="flex flex-col items-center py-3">
          <p className="font-black text-lg leading-none">{products.length}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-0.5">
            <Package className="w-2.5 h-2.5" />Products
          </p>
        </div>
        <div className="flex flex-col items-center py-3">
          <p className="font-black text-lg leading-none">{totalSales}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-0.5">
            <TrendingUp className="w-2.5 h-2.5" />Sold
          </p>
        </div>
        <div className="flex flex-col items-center py-3">
          {avgRating > 0 ? (
            <div className="flex items-center gap-0.5">
              <p className="font-black text-lg leading-none">{avgRating.toFixed(1)}</p>
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 mt-0.5" />
            </div>
          ) : (
            <p className="font-black text-lg leading-none text-muted-foreground">—</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-0.5">{totalReviews} reviews</p>
        </div>
        <div className="flex flex-col items-center py-3">
          <p className="font-black text-lg leading-none">{totalViews > 999 ? `${(totalViews / 1000).toFixed(1)}k` : totalViews}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-0.5">
            <Eye className="w-2.5 h-2.5" />Views
          </p>
        </div>
      </div>

      {/* ── Content Area ── */}
      <div className="p-4">
        {/* Orders Inbox — owner only */}
        {isOwner && activeTab === 'orders' && (
          <div>
            {loadingOrders ? (
              <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
            ) : orders.length === 0 ? (
              <div className="text-center py-20">
                <ShoppingCart className="w-16 h-16 text-muted-foreground/20 mx-auto mb-4" />
                <h2 className="text-lg font-bold mb-2">No orders yet</h2>
                <p className="text-sm text-muted-foreground mb-4">Orders from buyers will appear here</p>
                <button onClick={() => navigate('/marketplace')}
                  className="px-5 py-2.5 bg-primary text-primary-foreground rounded-full font-semibold text-sm hover:opacity-90">
                  Browse Marketplace
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingOrderCount > 0 && (
                  <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/[0.08] border border-amber-500/20 rounded-2xl">
                    <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
                        {pendingOrderCount} new order{pendingOrderCount !== 1 ? 's' : ''} awaiting action
                      </p>
                      <p className="text-xs text-muted-foreground">Mark orders as shipped to keep buyers informed</p>
                    </div>
                  </div>
                )}

                {/* Revenue summary */}
                <div className="grid grid-cols-3 gap-2 mb-1">
                  <div className="text-center p-3 bg-muted/40 rounded-xl">
                    <p className="text-lg font-black text-green-600">${orders.reduce((s, o) => s + Number(o.total_amount ?? 0), 0).toFixed(2)}</p>
                    <p className="text-[10px] text-muted-foreground">Total Revenue</p>
                  </div>
                  <div className="text-center p-3 bg-muted/40 rounded-xl">
                    <p className="text-lg font-black text-amber-600">{pendingOrderCount}</p>
                    <p className="text-[10px] text-muted-foreground">Pending</p>
                  </div>
                  <div className="text-center p-3 bg-muted/40 rounded-xl">
                    <p className="text-lg font-black text-blue-600">{deliveredOrderCount}</p>
                    <p className="text-[10px] text-muted-foreground">Delivered</p>
                  </div>
                </div>

                {/* Order cards sorted: pending first */}
                {[...orders]
                  .sort((a, b) => {
                    const ord = ['confirmed', 'shipped', 'delivered', 'cancelled'];
                    return (ord.indexOf(a.status) - ord.indexOf(b.status))
                      || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                  })
                  .map(order => {
                    const buyer   = order.buyer   ?? {};
                    const product = order.products ?? {};
                    const total   = Number(order.total_amount ?? 0);
                    const statusCls = ORDER_STATUS_CLS[order.status] ?? ORDER_STATUS_CLS.confirmed;
                    const isUpdating = updatingOrderId === order.id;
                    const statusLabel = (order.status ?? 'confirmed').charAt(0).toUpperCase() + (order.status ?? 'confirmed').slice(1);
                    return (
                      <div key={order.id} className="bg-card border border-border rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
                        <div className="flex gap-3 p-4">
                          <div className="w-16 h-16 rounded-xl bg-muted overflow-hidden shrink-0">
                            {product.image_url
                              ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-6 h-6 text-muted-foreground/40" /></div>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-bold text-sm leading-snug line-clamp-1 flex-1">{product.name ?? 'Product'}</p>
                              <span className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusCls}`}>
                                {order.status === 'confirmed'  && <Clock        className="w-2.5 h-2.5" />}
                                {order.status === 'shipped'    && <Truck        className="w-2.5 h-2.5" />}
                                {order.status === 'delivered'  && <CheckCircle2 className="w-2.5 h-2.5" />}
                                {statusLabel}
                              </span>
                            </div>
                            <p className="text-lg font-black text-primary mt-0.5">${total.toFixed(2)}</p>
                            <p className="text-[11px] text-muted-foreground">Qty: {order.quantity ?? 1} · {new Date(order.created_at).toLocaleDateString()}</p>
                            {order.note && (
                              <p className="text-[11px] text-muted-foreground italic mt-0.5 line-clamp-1">Buyer: "{order.note}"</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/20">
                          <button onClick={() => navigate(`/profile/${buyer.username}`)}
                            className="flex items-center gap-2 hover:opacity-80">
                            <div className="w-6 h-6 rounded-full bg-muted overflow-hidden shrink-0">
                              {buyer.avatar_url
                                ? <img src={buyer.avatar_url} alt="" className="w-full h-full object-cover" />
                                : <div className="w-full h-full flex items-center justify-center text-[9px] font-bold">{buyer.username?.[0]?.toUpperCase()}</div>}
                            </div>
                            <span className="text-xs font-semibold">@{buyer.username}</span>
                            {buyer.verified && <BadgeCheck className="w-3 h-3 text-primary" />}
                          </button>
                          <button onClick={() => handleDMBuyer(buyer.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-full text-xs font-bold transition-colors">
                            <MessageSquare className="w-3.5 h-3.5" /> Message
                          </button>
                        </div>

                        {order.status === 'confirmed' && (
                          <div className="px-4 py-3 border-t border-border">
                            <button onClick={() => handleOrderStatus(order.id, 'shipped')} disabled={isUpdating}
                              className="w-full flex items-center justify-center gap-1.5 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold hover:bg-amber-600 transition-colors disabled:opacity-50">
                              {isUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
                              Mark as Shipped
                            </button>
                          </div>
                        )}
                        {order.status === 'shipped' && (
                          <div className="px-4 py-3 border-t border-border">
                            <button onClick={() => handleOrderStatus(order.id, 'delivered')} disabled={isUpdating}
                              className="w-full flex items-center justify-center gap-1.5 py-2 bg-green-500 text-white rounded-xl text-xs font-bold hover:bg-green-600 transition-colors disabled:opacity-50">
                              {isUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                              Mark as Delivered
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Products Grid — default or non-owner view */}
        {(!isOwner || activeTab === 'products') && (
          products.length === 0 ? (
            <div className="text-center py-16">
              <ShoppingBag className="w-16 h-16 text-muted-foreground/20 mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">No products yet</h2>
              <p className="text-sm text-muted-foreground mb-4">
                {isOwner ? 'List your first product to start selling.' : `@${profile.username} hasn't listed any products.`}
              </p>
              {isOwner && (
                <button onClick={() => navigate('/products')}
                  className="px-5 py-2.5 bg-primary text-primary-foreground rounded-full font-semibold text-sm hover:opacity-90">
                  List Products
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-base">{products.length} Product{products.length !== 1 ? 's' : ''}</h2>
                {isOwner && (
                  <button onClick={() => navigate('/products')}
                    className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline">
                    <Package className="w-3.5 h-3.5" /> Manage listings
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {products.map(product => (
                  <StorefrontCard
                    key={product.id}
                    product={product}
                    wishlisted={isWishlisted(product.id)}
                    onWishlist={() => toggleWishlist(product.id)}
                    onBoost={() => setBoostProduct(product)}
                    isOwner={isOwner}
                  />
                ))}
              </div>
            </>
          )
        )}
      </div>

      {boostProduct && (
        <BoostDialog product={boostProduct} onClose={() => setBoostProduct(null)} />
      )}
    </div>
  );
}
