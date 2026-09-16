
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import {
  Search, MapPin, Tag, Star, Heart, ExternalLink, Loader2,
  ShoppingBag, Filter, X, ChevronRight, BadgeCheck, SlidersHorizontal,
  Package, TrendingUp, Sparkles, Grid3x3, LayoutList, MessageSquare,
  HelpCircle, DollarSign, ArrowUpDown, ShoppingCart, Check
} from 'lucide-react';
import { toast } from 'sonner';

function MktAdBanner() { return <PageAdBanner />; }

// ── Purchase Dialog ─────────────────────────────────────────────────────────────────
function PurchaseDialog({ product, onClose }: { product: any; onClose: () => void }) {
  const { user } = useAuth();
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const total = Number(product.price) * qty;

  const handlePurchase = async () => {
    if (!user) { toast.error('Sign in to purchase'); return; }
    if (user.id === product.user_id) { toast.error("You can't buy your own product"); return; }
    setSubmitting(true);
    const { error } = await supabase.from('orders').insert({
      buyer_id: user.id,
      seller_id: product.user_id,
      product_id: product.id,
      quantity: qty,
      unit_price: Number(product.price),
      total_amount: total,
      status: 'confirmed',
      note: note.trim() || null,
    });
    if (error) { toast.error(error.message); setSubmitting(false); return; }
    // Update sales_count
    await supabase.from('products').update({ sales_count: (product.sales_count ?? 0) + qty }).eq('id', product.id);
    // Notify seller
    await supabase.from('notifications').insert({ recipient_id: product.user_id, kind: 'payment_sent', actor_id: user.id,
     }).catch(() => {});
    // Record creator earning
    await supabase.from('creator_earnings').insert({
      user_id: product.user_id,
      source: 'marketplace',
      amount: total,
      status: 'pending',
    }).catch(() => {});
    setDone(true);
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-[400] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {done ? (
          <div className="text-center py-10 px-6 space-y-3">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
              <Check className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="font-black text-xl">Order Placed!</h3>
            <p className="text-sm text-muted-foreground">
              Your order for <strong>{product.name}</strong> has been recorded. The seller will be notified to fulfil your order.
            </p>
            <p className="text-xs text-muted-foreground">Check your profile for order history.</p>
            <button onClick={onClose} className="mt-2 w-full py-3 bg-primary text-primary-foreground rounded-2xl font-bold">Done</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="font-bold text-base">Place Order</h3>
                <p className="text-xs text-muted-foreground line-clamp-1">{product.name}</p>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Product preview */}
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-muted/40 border border-border">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="w-14 h-14 rounded-xl object-cover shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center shrink-0"><ShoppingBag className="w-6 h-6 text-muted-foreground" /></div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">{product.name}</p>
                  <p className="text-lg font-black text-primary">${Number(product.price).toFixed(2)} each</p>
                  {product.stock > 0 && <p className="text-[10px] text-muted-foreground">{product.stock} in stock</p>}
                </div>
              </div>

              {/* Quantity */}
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Quantity</p>
                <div className="flex items-center gap-3">
                  <button onClick={() => setQty(q => Math.max(1, q - 1))}
                    className="w-10 h-10 rounded-full border border-border flex items-center justify-center text-lg font-bold hover:bg-muted transition-colors">−</button>
                  <span className="text-xl font-black w-8 text-center">{qty}</span>
                  <button onClick={() => setQty(q => q + 1)}
                    className="w-10 h-10 rounded-full border border-border flex items-center justify-center text-lg font-bold hover:bg-muted transition-colors">+</button>
                </div>
              </div>

              {/* Note */}
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Note to Seller (optional)</p>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={200}
                  placeholder="Any special requests, size, colour…"
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>

              {/* Total */}
              <div className="flex items-center justify-between px-3 py-2.5 bg-primary/5 border border-primary/20 rounded-xl">
                <span className="text-sm font-semibold">Total</span>
                <span className="text-xl font-black text-primary">${total.toFixed(2)}</span>
              </div>

              <p className="text-[10px] text-muted-foreground text-center">
                The seller will contact you to arrange payment and delivery. No charge is made now.
              </p>

              <button onClick={handlePurchase} disabled={submitting}
                className="w-full py-3.5 bg-primary text-primary-foreground rounded-2xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShoppingCart className="w-5 h-5" />}
                {submitting ? 'Placing Order…' : `Order · $${total.toFixed(2)}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Module-level category config (esbuild-safe: no inline objects in render) ──
const CATEGORIES = [
  { id: 'all',         label: 'All',          emoji: '🛍️' },
  { id: 'digital',     label: 'Digital',      emoji: '💻' },
  { id: 'handmade',    label: 'Handmade',     emoji: '🧵' },
  { id: 'fashion',     label: 'Fashion',      emoji: '👗' },
  { id: 'art',         label: 'Art',          emoji: '🎨' },
  { id: 'food',        label: 'Food',         emoji: '🍜' },
  { id: 'electronics', label: 'Electronics',  emoji: '📱' },
  { id: 'books',       label: 'Books',        emoji: '📚' },
  { id: 'beauty',      label: 'Beauty',       emoji: '💄' },
  { id: 'home',        label: 'Home',         emoji: '🏠' },
  { id: 'sports',       label: 'Sports',       emoji: '⚽' },
  { id: 'music',       label: 'Music',        emoji: '🎵' },
  { id: 'toys',        label: 'Toys',         emoji: '🧸' },
  { id: 'other',       label: 'Other',        emoji: '📦' },
];

const REGIONS = [
  { id: 'all',       label: 'Worldwide',    flag: '🌍' },
  { id: 'kenya',     label: 'Kenya',        flag: '🇰🇪' },
  { id: 'nigeria',   label: 'Nigeria',      flag: '🇳🇬' },
  { id: 'ghana',     label: 'Ghana',        flag: '🇬🇭' },
  { id: 'south_africa', label: 'South Africa', flag: '🇿🇦' },
  { id: 'us',        label: 'United States',flag: '🇺🇸' },
  { id: 'uk',        label: 'United Kingdom', flag: '🇬🇧' },
  { id: 'europe',    label: 'Europe',       flag: '🇪🇺' },
  { id: 'asia',      label: 'Asia',         flag: '🌏' },
];

const SORT_OPTIONS = [
  { id: 'popular',   label: 'Most Popular'  },
  { id: 'newest',    label: 'Newest'        },
  { id: 'price_asc', label: 'Price: Low→High' },
  { id: 'price_desc',label: 'Price: High→Low' },
  { id: 'rating',    label: 'Top Rated'     },
];

const PRICE_RANGES = [
  { id: 'all',    label: 'Any Price',  min: 0,   max: Infinity },
  { id: 'free',   label: 'Free',       min: 0,   max: 0        },
  { id: 'under5', label: 'Under $5',   min: 0,   max: 5        },
  { id: 'under25',label: 'Under $25',  min: 0,   max: 25       },
  { id: 'under50',label: 'Under $50',  min: 0,   max: 50       },
  { id: 'over50', label: '$50+',       min: 50,  max: Infinity },
];

// esbuild guard: module-level helpers — no IIFE in render
function getCategoryLabel(id: string): string {
  return CATEGORIES.find(c => c.id === id)?.label ?? 'All';
}
function getCategoryEmoji(id: string): string {
  return CATEGORIES.find(c => c.id === id)?.emoji ?? '🛍️';
}
function getRegionFlag(id: string): string {
  return REGIONS.find(r => r.id === id)?.flag ?? '🌍';
}
function getRegionLabel(id: string): string {
  return REGIONS.find(r => r.id === id)?.label ?? 'Worldwide';
}

// ── Star Rating ────────────────────────────────────────────────────────────
function StarRow({ rating, count }: { rating: number; count: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={`w-3 h-3 ${i <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30'}`}
        />
      ))}
      {count > 0 && <span className="text-[10px] text-muted-foreground">({count})</span>}
    </div>
  );
}

// ── Product Detail Sheet ────────────────────────────────────────────────────
function ProductDetailSheet({ product, onClose, onWishlist, wishlisted }: {
  product: any; onClose: () => void; onWishlist: () => void; wishlisted: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showPurchaseDialog, setShowPurchaseDialog] = useState(false);
  return ( // Added return statement here
    <div
      className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-background w-full max-w-lg max-h-[90vh] rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Image */}
        <div className="relative w-full h-64 bg-muted shrink-0 overflow-hidden">
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ShoppingBag className="w-16 h-16 text-muted-foreground/30" />
            </div>
          )}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-9 h-9 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={onWishlist}
            className={`absolute top-3 right-14 w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-sm transition-all ${
              wishlisted ? 'bg-red-500 text-white' : 'bg-black/50 text-white hover:bg-red-500'
            }`}
          >
            <Heart className={`w-4 h-4 ${wishlisted ? 'fill-white' : ''}`} />
          </button>
          {product.stock === 0 && (
            <div className="absolute bottom-3 left-3 px-3 py-1 bg-black/70 text-white rounded-full text-xs font-bold">
              Out of stock
            </div>
          )}
          {product.is_featured && (
            <div className="absolute top-3 left-3 flex items-center gap-1 px-2.5 py-1 bg-yellow-400/90 text-yellow-900 rounded-full text-[10px] font-bold">
              <Star className="w-2.5 h-2.5 fill-current" /> Featured
            </div>
          )}
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Header */}
          <div>
            <div className="flex items-start justify-between gap-3 mb-1">
              <h2 className="font-black text-xl leading-tight">{product.name}</h2>
              <p className="text-2xl font-black text-primary shrink-0">${Number(product.price).toFixed(2)}</p>
            </div>
            {product.avg_rating > 0 && (
              <StarRow rating={product.avg_rating} count={product.review_count ?? 0} />
            )}
          </div>

          {/* Seller */}
          <button
            onClick={() => { onClose(); navigate(`/seller/${product.user_profiles?.username}`); }}
            className="flex items-center gap-3 p-3 rounded-2xl bg-muted/40 hover:bg-muted/70 transition-colors w-full text-left"
          >
            <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
              {product.user_profiles?.avatar_url
                ? <img src={product.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center font-bold text-sm">
                    {product.user_profiles?.username?.[0]?.toUpperCase()}
                  </div>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className="font-semibold text-sm">@{product.user_profiles?.username}</span>
                {product.user_profiles?.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary" />}
              </div>
              <p className="text-xs text-muted-foreground">Seller profile</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </button>

          {/* Tags row */}
          <div className="flex flex-wrap gap-2">
            {product.category && product.category !== 'other' && (
              <span className="flex items-center gap-1 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-full text-xs font-semibold text-primary">
                <span>{getCategoryEmoji(product.category)}</span>
                {getCategoryLabel(product.category)}
              </span>
            )}
            {product.region && product.region !== 'all' && (
              <span className="flex items-center gap-1 px-3 py-1.5 bg-muted border border-border rounded-full text-xs font-semibold text-muted-foreground">
                <MapPin className="w-3 h-3" />
                <span>{getRegionFlag(product.region)}</span>
                {getRegionLabel(product.region)}
              </span>
            )}
            {product.stock !== null && product.stock > 0 && (
              <span className="flex items-center gap-1 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full text-xs font-semibold text-green-600">
                <Package className="w-3 h-3" /> {product.stock} in stock
              </span>
            )}
          </div>

          {/* Description */}
          {product.description && (
            <div>
              <h3 className="font-bold text-sm mb-2">Description</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{product.description}</p>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-3 bg-muted/40 rounded-xl">
              <p className="text-lg font-black">{product.views_count ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">Views</p>
            </div>
            <div className="text-center p-3 bg-muted/40 rounded-xl">
              <p className="text-lg font-black">{product.sales_count ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">Sold</p>
            </div>
            <div className="text-center p-3 bg-muted/40 rounded-xl">
              <p className="text-lg font-black">{product.review_count ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">Reviews</p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="px-5 py-4 border-t border-border shrink-0 flex gap-3">
          {product.external_link ? (
            <a
              href={product.external_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-primary text-primary-foreground rounded-2xl font-bold text-base hover:opacity-90 transition-opacity"
            >
              <ShoppingBag className="w-5 h-5" /> Buy Now <ExternalLink className="w-4 h-4" />
            </a>
          ) : (
            <button
              onClick={() => setShowPurchaseDialog(true)}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-primary text-primary-foreground rounded-2xl font-bold text-base hover:opacity-90 transition-opacity"
            >
              <ShoppingCart className="w-5 h-5" /> Place Order
            </button>
          )}
        </div>
      </div>
      {showPurchaseDialog && (
        <PurchaseDialog product={product} onClose={() => setShowPurchaseDialog(false)} />
      )}
    </div>
  );
}

// ── Product Card (Grid) ─────────────────────────────────────────────────────
function MktProductCard({
  product, wishlisted, onWishlist, onSelect, onTrackView,
}: {
  product: any; wishlisted: boolean;
  onWishlist: () => void; onSelect: () => void; onTrackView: () => void;
}) {
  return (
    <div
      className="rounded-2xl overflow-hidden border border-border bg-card hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group"
      onClick={() => { onTrackView(); onSelect(); }}
    >
      {/* Image */}
      <div className="relative w-full aspect-square bg-muted overflow-hidden">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ShoppingBag className="w-10 h-10 text-muted-foreground/30" />
          </div>
        )}
        {/* Wishlist btn */}
        <button
          onClick={e => { e.stopPropagation(); onWishlist(); }}
          className={`absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm ${
            wishlisted ? 'bg-red-500 text-white' : 'bg-black/40 text-white hover:bg-red-500'
          }`}
        >
          <Heart className={`w-3.5 h-3.5 ${wishlisted ? 'fill-white' : ''}`} />
        </button>
        {/* Featured badge */}
        {product.is_featured && (
          <div className="absolute top-2 left-2 flex items-center gap-0.5 px-2 py-0.5 bg-yellow-400/90 text-yellow-900 rounded-full text-[9px] font-bold">
            <Star className="w-2 h-2 fill-current" /> Featured
          </div>
        )}
        {/* Category badge */}
        {product.category && product.category !== 'other' && (
          <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 text-white rounded-full text-[9px] font-semibold">
            {getCategoryEmoji(product.category)} {getCategoryLabel(product.category)}
          </div>
        )}
        {product.stock === 0 && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <span className="px-3 py-1 bg-black/70 text-white rounded-full text-xs font-bold">Sold Out</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        <p className="font-semibold text-sm leading-tight line-clamp-2 mb-1">{product.name}</p>
        <p className="text-base font-black text-primary">${Number(product.price).toFixed(2)}</p>

        {product.avg_rating > 0 && (
          <StarRow rating={product.avg_rating} count={product.review_count ?? 0} />
        )}

        {/* Region */}
        {product.region && product.region !== 'all' && (
          <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
            <MapPin className="w-2.5 h-2.5" />
            <span>{getRegionFlag(product.region)} {getRegionLabel(product.region)}</span>
          </div>
        )}

        {/* Seller */}
        <div className="flex items-center gap-1.5 mt-2">
          <div className="w-5 h-5 rounded-full bg-muted overflow-hidden shrink-0">
            {product.user_profiles?.avatar_url
              ? <img src={product.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-[8px] font-bold">
                  {product.user_profiles?.username?.[0]?.toUpperCase()}
                </div>}
          </div>
          <span className="text-[10px] text-muted-foreground truncate flex-1">@{product.user_profiles?.username}</span>
          {product.user_profiles?.verified && <BadgeCheck className="w-3 h-3 text-primary shrink-0" />}
        </div>
      </div>
    </div>
  );
}

// ── Product List Item ───────────────────────────────────────────────────────
function MktListItem({
  product, wishlisted, onWishlist, onSelect, onTrackView,
}: {
  product: any; wishlisted: boolean;
  onWishlist: () => void; onSelect: () => void; onTrackView: () => void;
}) {
  return (
    <div
      className="flex gap-3 p-3.5 rounded-2xl border border-border bg-card hover:shadow-md hover:border-primary/20 transition-all cursor-pointer group"
      onClick={() => { onTrackView(); onSelect(); }}
    >
      {/* Thumbnail */}
      <div className="w-24 h-24 rounded-xl bg-muted overflow-hidden shrink-0 relative">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ShoppingBag className="w-8 h-8 text-muted-foreground/30" />
          </div>
        )}
        {product.is_featured && (
          <div className="absolute top-1.5 left-1.5 flex items-center gap-0.5 px-1.5 py-0.5 bg-yellow-400/90 text-yellow-900 rounded-full text-[8px] font-bold">
            <Star className="w-1.5 h-1.5 fill-current" /> Featured
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-bold text-sm leading-snug line-clamp-2 flex-1">{product.name}</h3>
          <button
            onClick={e => { e.stopPropagation(); onWishlist(); }}
            className={`shrink-0 w-7 h-7 rounded-full border flex items-center justify-center transition-all ${
              wishlisted ? 'bg-red-500/10 border-red-500/30 text-red-500' : 'border-border text-muted-foreground hover:text-red-500 hover:border-red-500/30'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${wishlisted ? 'fill-red-500' : ''}`} />
          </button>
        </div>

        {product.description && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-1.5">{product.description}</p>
        )}

        <p className="text-lg font-black text-primary">${Number(product.price).toFixed(2)}</p>

        {product.avg_rating > 0 && (
          <StarRow rating={product.avg_rating} count={product.review_count ?? 0} />
        )}

        {/* Meta row */}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {product.category && product.category !== 'other' && (
            <span className="text-[10px] text-primary font-semibold">
              {getCategoryEmoji(product.category)} {getCategoryLabel(product.category)}
            </span>
          )}
          {product.region && product.region !== 'all' && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <MapPin className="w-2.5 h-2.5" /> {getRegionFlag(product.region)} {getRegionLabel(product.region)}
            </span>
          )}
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
            @{product.user_profiles?.username}
            {product.user_profiles?.verified && <BadgeCheck className="w-2.5 h-2.5 text-primary" />}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Filter Sheet ────────────────────────────────────────────────────────────
function FilterSheet({
  category, region, priceRange, sort,
  onCategory, onRegion, onPriceRange, onSort, onClose, onReset,
}: {
  category: string; region: string; priceRange: string; sort: string;
  onCategory: (v: string) => void; onRegion: (v: string) => void;
  onPriceRange: (v: string) => void; onSort: (v: string) => void;
  onClose: () => void; onReset: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-background w-full max-w-lg max-h-[90vh] rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-lg">Filters</h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onReset} className="text-sm text-muted-foreground hover:text-primary transition-colors font-semibold">Reset</button>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-6">
          {/* Sort */}
          <div>
            <h4 className="font-bold text-sm mb-3 flex items-center gap-2"><ArrowUpDown className="w-4 h-4 text-primary" /> Sort By</h4>
            <div className="flex flex-wrap gap-2">
              {SORT_OPTIONS.map(s => (
                <button
                  key={s.id}
                  onClick={() => onSort(s.id)}
                  className={`px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                    sort === s.id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40 hover:bg-primary/5'
                  }`}
                >{s.label}</button>
              ))}
            </div>
          </div>

          {/* Price */}
          <div>
            <h4 className="font-bold text-sm mb-3 flex items-center gap-2"><Tag className="w-4 h-4 text-primary" /> Price Range</h4>
            <div className="flex flex-wrap gap-2">
              {PRICE_RANGES.map(p => (
                <button
                  key={p.id}
                  onClick={() => onPriceRange(p.id)}
                  className={`px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                    priceRange === p.id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40 hover:bg-primary/5'
                  }`}
                >{p.label}</button>
              ))}
            </div>
          </div>

          {/* Region */}
          <div>
            <h4 className="font-bold text-sm mb-3 flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" /> Region of Sale</h4>
            <div className="flex flex-wrap gap-2">
              {REGIONS.map(r => (
                <button
                  key={r.id}
                  onClick={() => onRegion(r.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                    region === r.id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40 hover:bg-primary/5'
                  }`}
                >
                  <span>{r.flag}</span>{r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="w-full py-3 bg-primary text-primary-foreground rounded-2xl font-bold hover:opacity-90 transition-opacity">
            Apply Filters
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Marketplace Page ───────────────────────────────────────────────────
export default function MarketplacePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Data
  const [products, setProducts] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [loading, setLoading]   = useState(true);

  // Filters
  const [search,     setSearch]     = useState('');
  const [category,   setCategory]   = useState('all');
  const [region,     setRegion]     = useState('all');
  const [priceRange, setPriceRange] = useState('all');
  const [sort,       setSort]       = useState('popular');
  const [gridMode,   setGridMode]   = useState('grid' as 'grid' | 'list');

  // UI state
  const [showFilters,   setShowFilters]   = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null as any);

  // Wishlist — parallel arrays (esbuild guard: no Set<string> in state)
  const [wishlistIds, setWishlistIds] = useState([] as string[]);

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
      // Sync to DB for price-drop alerts (fire-and-forget)
      if (user) {
        if (!prev.includes(id)) {
          // Adding — upsert with current price
          const product = (products as any[]).find((p: any) => p.id === id);
          supabase.from('product_wishlists').upsert(
            { user_id: user.id, product_id: id, last_price: product?.price ?? null },
            { onConflict: 'user_id,product_id' }
          ).catch(() => {});
        } else {
          // Removing
          supabase.from('product_wishlists').delete()
            .eq('user_id', user.id).eq('product_id', id).catch(() => {});
        }
      }
      return next;
    });
  };

  useSEO({
    title: 'Marketplace — Shop & Sell on Testagram',
    description: `Browse products from creators worldwide. Filter by category, region, and price. ${products.length} products available.`,
    url: '/marketplace',
    keywords: 'marketplace, shop, buy, sell, products, creators, testagram, kenya, africa',
  });

  useEffect(() => { fetchProducts(); }, []);

  const fetchProducts = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('products')
      .select('*, profiles(id, username, avatar_url, verified)')
      .eq('is_active', true)
      .order('views_count', { ascending: false })
      .limit(120);
    const all = data ?? [];
    setProducts(all);
    setFeatured(all.filter((p: any) => p.is_featured).slice(0, 6));
    setLoading(false);
  };

  const trackView = async (id: string) => {
    await supabase.rpc('increment', { row_id: id, table_name: 'products', column_name: 'views_count' }).catch(() => {});
  };

  const resetFilters = () => {
    setCategory('all'); setRegion('all'); setPriceRange('all'); setSort('popular'); setSearch('');
  };

  // Derived filtered + sorted list
  const filtered = useMemo(() => {
    let list = [...products] as any[];

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        (p.name ?? '').toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q)
      );
    }

    // Category
    if (category !== 'all') {
      list = list.filter(p => (p.category ?? 'other') === category);
    }

    // Region
    if (region !== 'all') {
      list = list.filter(p => (p.region ?? 'all') === region || (p.region ?? 'all') === 'all');
    }

    // Price range
    const pr = PRICE_RANGES.find(r => r.id === priceRange);
    if (pr && pr.id !== 'all') {
      list = list.filter(p => {
        const price = Number(p.price ?? 0);
        return price >= pr.min && price <= pr.max;
      });
    }

    // Sort
    if (sort === 'newest')     list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (sort === 'price_asc')  list.sort((a, b) => Number(a.price) - Number(b.price));
    if (sort === 'price_desc') list.sort((a, b) => Number(b.price) - Number(a.price));
    if (sort === 'rating')     list.sort((a, b) => Number(b.avg_rating ?? 0) - Number(a.avg_rating ?? 0));
    if (sort === 'popular')    list.sort((a, b) => Number(b.views_count ?? 0) - Number(a.views_count ?? 0));

    return list;
  }, [products, search, category, region, priceRange, sort]);

  const activeFilterCount = [
    category !== 'all', region !== 'all', priceRange !== 'all', sort !== 'popular',
  ].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Marketplace" />
      <MktAdBanner />

      {/* ── Sticky Search + Filter bar ── */}
      <div className="sticky top-14 z-30 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products, sellers…"
              className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(true)}
            className={`relative flex items-center gap-1.5 px-3 py-2.5 border rounded-xl font-semibold text-sm transition-all ${
              activeFilterCount > 0 ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted text-muted-foreground'
            }`}
          >
            <Filter className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 bg-primary text-primary-foreground text-[9px] font-black rounded-full flex items-center justify-center">{activeFilterCount}</span>
            )}
          </button>
          <button
            onClick={() => setGridMode(g => g === 'grid' ? 'list' : 'grid')}
            className="p-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-muted-foreground"
          >
            {gridMode === 'grid' ? <LayoutList className="w-4 h-4" /> : <Grid3x3 className="w-4 h-4" />}
          </button>
        </div>

        {/* Category pills */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                category === cat.id
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-primary'
              }`}
            >
              <span>{cat.emoji}</span>{cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Hero / Featured strip ── */}
      {!search && category === 'all' && featured.length > 0 && !loading && (
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="font-bold">Featured Products</h2>
            <span className="text-xs text-muted-foreground ml-auto">{featured.length} items</span>
          </div>
          <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
            {featured.map(p => (
              <button
                key={p.id}
                onClick={() => { trackView(p.id); setSelectedProduct(p); }}
                className="shrink-0 w-44 rounded-2xl overflow-hidden border border-amber-500/30 bg-gradient-to-b from-amber-500/5 to-card hover:shadow-lg hover:-translate-y-0.5 transition-all group text-left"
              >
                <div className="w-full h-32 bg-muted relative overflow-hidden">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-8 h-8 text-muted-foreground/30" /></div>
                  )}
                  <div className="absolute top-2 left-2 flex items-center gap-0.5 px-2 py-0.5 bg-yellow-400/90 text-yellow-900 rounded-full text-[9px] font-bold">
                    <Star className="w-2 h-2 fill-current" /> Featured
                  </div>
                </div>
                <div className="p-3">
                  <p className="font-semibold text-xs leading-tight line-clamp-1">{p.name}</p>
                  <p className="text-sm font-black text-primary mt-0.5">${Number(p.price).toFixed(2)}</p>
                  {p.region && p.region !== 'all' && (
                    <p className="text-[9px] text-muted-foreground mt-1 flex items-center gap-1">
                      <MapPin className="w-2 h-2" />{getRegionFlag(p.region)} {getRegionLabel(p.region)}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Stats bar ── */}
      {!loading && (
        <div className="flex items-center gap-4 px-4 py-2.5 border-y border-border bg-muted/20">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-green-500" />
            <span className="text-sm font-semibold text-foreground">{filtered.length}</span>
            <span className="text-xs text-muted-foreground">products</span>
          </div>
          {activeFilterCount > 0 && (
            <button onClick={resetFilters} className="flex items-center gap-1 text-xs text-primary font-semibold hover:underline ml-auto">
              <X className="w-3 h-3" /> Clear filters
            </button>
          )}
          {user && (
            <button
              onClick={() => navigate('/products')}
              className="flex items-center gap-1.5 text-xs text-primary font-semibold ml-auto"
            >
              <ShoppingBag className="w-3.5 h-3.5" /> Sell
            </button>
          )}
        </div>
      )}

      {/* ── Product Grid / List ── */}
      <div className="p-4">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <ShoppingBag className="w-16 h-16 text-muted-foreground/20 mx-auto mb-4" />
            <h2 className="text-lg font-bold mb-2">No products found</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {search ? `No results for "${search}"` : 'Try adjusting your filters'}
            </p>
            <button onClick={resetFilters} className="px-5 py-2.5 bg-primary text-primary-foreground rounded-full font-semibold text-sm hover:opacity-90">
              Reset Filters
            </button>
          </div>
        ) : gridMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map((product: any) => (
              <MktProductCard
                key={product.id}
                product={product}
                wishlisted={isWishlisted(product.id)}
                onWishlist={() => toggleWishlist(product.id)}
                onSelect={() => setSelectedProduct(product)}
                onTrackView={() => trackView(product.id)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((product: any) => (
              <MktListItem
                key={product.id}
                product={product}
                wishlisted={isWishlisted(product.id)}
                onWishlist={() => toggleWishlist(product.id)}
                onSelect={() => setSelectedProduct(product)}
                onTrackView={() => trackView(product.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Filter Sheet ── */}
      {showFilters && (
        <FilterSheet
          category={category} region={region} priceRange={priceRange} sort={sort}
          onCategory={setCategory} onRegion={setRegion} onPriceRange={setPriceRange} onSort={setSort}
          onClose={() => setShowFilters(false)}
          onReset={resetFilters}
        />
      )}

      {/* ── Product Detail Sheet ── */}
      {selectedProduct && (
        <ProductDetailSheet
          product={selectedProduct}
          wishlisted={isWishlisted(selectedProduct.id)}
          onWishlist={() => toggleWishlist(selectedProduct.id)}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </div>
  );
}
