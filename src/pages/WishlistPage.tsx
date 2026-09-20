import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { ShoppingBag, Trash2, ExternalLink, Package, ArrowRight, BadgeCheck, Star } from 'lucide-react';
import { toast } from 'sonner';

// ── AdSense banner — push-guarded ─────────────────────────────────────────────
import { PageAdBanner } from '@/components/features/AdSenseAd';
function WishlistAdBanner() { return <PageAdBanner />; }

interface WishlistProduct {
  id: string;
  name: string;
  description?: string;
  price: number;
  image_url?: string;
  external_link?: string;
  is_featured?: boolean;
  user_id: string;
  seller?: {
    id: string;
    username: string;
    avatar_url?: string;
    verified?: boolean;
  };
}

const WISHLIST_KEY = 'product_wishlist';

export default function WishlistPage() {
  const { user } = useAuth();
  useSEO({ noindex: true, title: 'Wishlist', url: '/wishlist' });
  const navigate = useNavigate();
  const [wishlistIds, setWishlistIds] = useState([] as string[]);
  const [products, setProducts] = useState([] as WishlistProduct[]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = localStorage.getItem(WISHLIST_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    setWishlistIds(ids);
    if (ids.length > 0) fetchProducts(ids);
    else setLoading(false);
  }, []);

  const fetchProducts = async (ids: string[]) => {
    setLoading(true);
    const { data } = await supabase
      .from('products')
      .select('*, profiles!products_user_id_fkey(id, username, avatar_url, verified)')
      .in('id', ids)
      .eq('is_active', true);
    const enriched = (data ?? []).map((p: any) => ({
      ...p,
      seller: p.profiles,
    }));
    // Preserve wishlist order
    const ordered = ids
      .map(id => enriched.find((p: any) => p.id === id))
      .filter(Boolean) as WishlistProduct[];
    setProducts(ordered);
    setLoading(false);
  };

  const removeFromWishlist = (id: string) => {
    const updated = wishlistIds.filter(wid => wid !== id);
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(updated));
    setWishlistIds(updated);
    setProducts(prev => prev.filter(p => p.id !== id));
    toast.success('Removed from wishlist');
  };

  const clearAll = () => {
    if (!window.confirm('Remove all items from your wishlist?')) return;
    localStorage.removeItem(WISHLIST_KEY);
    setWishlistIds([]);
    setProducts([]);
    toast.success('Wishlist cleared');
  };

  const total = products.reduce((s, p) => s + Number(p.price), 0);
  const hasExternal = products.some(p => p.external_link);

  const shopAll = () => {
    products
      .filter(p => p.external_link)
      .forEach(p => window.open(p.external_link!, '_blank', 'noopener'));
  };

  if (!user) {
    navigate('/auth');
    return null;
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Wishlist" showBack />
      <WishlistAdBanner />

      {/* Header stats */}
      {products.length > 0 && (
        <div className="px-4 py-4 border-b border-border bg-muted/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {products.length} item{products.length !== 1 ? 's' : ''} saved
              </p>
              <p className="text-2xl font-black text-primary">
                ${total.toFixed(2)}
                <span className="text-sm font-normal text-muted-foreground ml-1">total</span>
              </p>
            </div>
            <div className="flex gap-2">
              {hasExternal && (
                <button
                  onClick={shopAll}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-bold hover:opacity-90 transition-opacity"
                >
                  <ShoppingBag className="w-4 h-4" />
                  Shop All
                </button>
              )}
              <button
                onClick={clearAll}
                className="flex items-center gap-1.5 px-3 py-2 border border-destructive/40 text-destructive rounded-full text-sm font-medium hover:bg-destructive/5 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 p-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden animate-pulse">
              <div className="h-40 bg-muted" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-muted rounded w-3/4" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
          <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-5">
            <ShoppingBag className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-xl font-bold mb-2">Your wishlist is empty</h2>
          <p className="text-muted-foreground text-sm mb-6 max-w-xs">
            Browse the marketplace and tap the heart icon to save products you love.
          </p>
          <button
            onClick={() => navigate('/products')}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full font-bold text-sm hover:opacity-90 transition-opacity"
          >
            <Package className="w-4 h-4" />
            Browse Marketplace
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 p-4">
            {products.map(product => (
              <div
                key={product.id}
                className="rounded-2xl border border-border bg-card overflow-hidden group hover:shadow-md transition-shadow relative"
              >
                {/* Remove button */}
                <button
                  onClick={() => removeFromWishlist(product.id)}
                  className="absolute top-2 right-2 z-10 w-7 h-7 bg-black/50 hover:bg-destructive/80 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                  title="Remove from wishlist"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                {/* Featured badge */}
                {product.is_featured && (
                  <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/90 backdrop-blur-sm rounded-full">
                    <Star className="w-2.5 h-2.5 text-white fill-white" />
                    <span className="text-[9px] font-bold text-white uppercase tracking-wide">Featured</span>
                  </div>
                )}

                {/* Image */}
                <div className="h-40 bg-muted overflow-hidden">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="w-10 h-10 text-muted-foreground/30" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-3 space-y-2">
                  <p className="font-semibold text-sm leading-tight line-clamp-2">{product.name}</p>
                  <p className="text-xl font-black text-primary">${Number(product.price).toFixed(2)}</p>

                  {/* Seller */}
                  {product.seller && (
                    <button
                      onClick={() => navigate(`/profile/${product.seller!.username}`)}
                      className="flex items-center gap-1.5 text-left w-full"
                    >
                      <div className="w-4 h-4 rounded-full bg-muted overflow-hidden shrink-0">
                        {product.seller.avatar_url ? (
                          <img src={product.seller.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-primary/20 flex items-center justify-center text-[6px] font-bold text-primary">
                            {product.seller.username[0]?.toUpperCase()}
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground truncate">{product.seller.username}</span>
                      {product.seller.verified && (
                        <BadgeCheck className="w-3 h-3 text-primary shrink-0" />
                      )}
                    </button>
                  )}

                  {/* CTA */}
                  {product.external_link ? (
                    <a
                      href={product.external_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center justify-center gap-1.5 w-full py-2 bg-primary text-primary-foreground text-xs font-bold rounded-xl hover:opacity-90 transition-opacity"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Buy Now
                    </a>
                  ) : (
                    <div className="w-full py-2 bg-muted text-muted-foreground text-xs font-medium rounded-xl text-center">
                      View in Marketplace
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Browse more */}
          <div className="px-4 pb-6">
            <button
              onClick={() => navigate('/products')}
              className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-border rounded-2xl text-sm text-muted-foreground hover:bg-muted/30 transition-colors"
            >
              <ShoppingBag className="w-4 h-4" />
              Browse more products
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

