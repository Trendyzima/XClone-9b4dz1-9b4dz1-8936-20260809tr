
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import {
  ShoppingBag, ShoppingCart, Package, Truck, CheckCircle2,
  Loader2, MessageSquare, X, Star, Clock, ChevronRight,
  DollarSign, BadgeCheck, ArrowRight, AlertCircle, Search,
  Send, Copy, MapPin, Hash, TrendingUp, Calendar
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow, format, subDays } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// ── Module-level status config (esbuild-safe: no inline objects in render) ──
const STATUS_CFG = {
  confirmed:  { label: 'Confirmed',  icon: 'confirmed',  cls: 'bg-blue-500/10 text-blue-600 border-blue-500/20'   },
  shipped:    { label: 'Shipped',    icon: 'shipped',    cls: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  delivered:  { label: 'Delivered',  icon: 'delivered',  cls: 'bg-green-500/10 text-green-600 border-green-500/20' },
  cancelled:  { label: 'Cancelled',  icon: 'cancelled',  cls: 'bg-red-500/10 text-red-500 border-red-500/20'       },
};

// Filter tabs (esbuild-safe: module-level)
const FILTER_TABS = ['all', 'confirmed', 'shipped', 'delivered'] as const;
type FilterTab = typeof FILTER_TABS[number];

const FILTER_LABELS: Record<FilterTab, string> = {
  all: 'All', confirmed: 'Pending', shipped: 'Shipped', delivered: 'Delivered',
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status as keyof typeof STATUS_CFG] ?? STATUS_CFG.confirmed;
  return (
    <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${cfg.cls}`}>
      {cfg.icon === 'confirmed'  && <Clock        className="w-3 h-3" />}
      {cfg.icon === 'shipped'    && <Truck        className="w-3 h-3" />}
      {cfg.icon === 'delivered'  && <CheckCircle2 className="w-3 h-3" />}
      {cfg.icon === 'cancelled'  && <X            className="w-3 h-3" />}
      {cfg.label}
    </span>
  );
}

// ── Order Detail Sheet ─────────────────────────────────────────────────────
function OrderDetailSheet({ order, isSeller, onClose, navigate, onStatusUpdate }: {
  order: any; isSeller: boolean; onClose: () => void;
  navigate: (p: string) => void;
  onStatusUpdate?: (id: string, status: string) => void;
}) {
  const { user } = useAuth();
  const product = order.products ?? {};
  const buyer   = order.buyer   ?? {};
  const seller  = order.seller  ?? {};
  const other   = isSeller ? buyer : seller;
  const total   = Number(order.total_amount ?? 0);
  const unit    = Number(order.unit_price   ?? 0);
  const [updating, setUpdating] = useState(false);

  const handleCopyId = () => {
    navigator.clipboard.writeText(order.id).then(() => toast.success('Order ID copied')).catch(() => {});
  };

  const handleDM = async () => {
    if (!user || !other.id) return;
    const p1 = isSeller ? order.seller_id : order.buyer_id;
    const p2 = isSeller ? order.buyer_id  : order.seller_id;
    const { data: existing } = await supabase
      .from('conversations').select('id')
      .or(`and(participant_1.eq.${p1},participant_2.eq.${p2}),and(participant_1.eq.${p2},participant_2.eq.${p1})`)
      .maybeSingle();
    if (existing?.id) { navigate(`/messages?conv=${existing.id}`); onClose(); return; }
    const { data: conv } = await supabase.from('conversations')
      .insert({ participant_1: p1, participant_2: p2 }).select('id').single();
    if (conv?.id) { navigate(`/messages?conv=${conv.id}`); onClose(); }
  };

  const handleStatusChange = async (newStatus: string) => {
    setUpdating(true);
    const { error } = await supabase.from('orders').update({
      status: newStatus,
      ...(newStatus === 'shipped'   ? { shipped_at:   new Date().toISOString() } : {}),
      ...(newStatus === 'delivered' ? { delivered_at: new Date().toISOString() } : {}),
    }).eq('id', order.id);
    if (error) { toast.error(error.message); setUpdating(false); return; }
    supabase.functions.invoke('send-push-notification', {
      body: {
        user_id: order.buyer_id,
        title:   newStatus === 'shipped' ? '📦 Order Shipped!' : '✅ Order Delivered!',
        body:    newStatus === 'shipped'
          ? `Your order for "${product.name ?? 'your item'}" has been shipped.`
          : `Your order for "${product.name ?? 'your item'}" has been delivered!`,
        data: { route: '/orders', type: 'order_status' },
      },
    }).catch(() => {});
    toast.success(`Order marked as ${newStatus}`);
    onStatusUpdate?.(order.id, newStatus);
    onClose();
    setUpdating(false);
  };

  // Timeline events
  const timeline = [
    { label: 'Order Confirmed', date: order.created_at, icon: 'confirmed', done: true },
    { label: 'Shipped',         date: order.shipped_at,  icon: 'shipped',  done: !!order.shipped_at },
    { label: 'Delivered',       date: order.delivered_at,icon: 'delivered',done: !!order.delivered_at },
  ];

  return (
    <div className="fixed inset-0 z-[400] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-background w-full max-w-lg max-h-[92vh] rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="font-bold text-base">Order Details</h3>
            <button onClick={handleCopyId} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors">
              <Hash className="w-2.5 h-2.5" />{order.id.slice(0, 8)}…
              <Copy className="w-2.5 h-2.5" />
            </button>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Product */}
          <div className="flex gap-3 p-3 rounded-2xl bg-muted/40 border border-border">
            <div className="w-16 h-16 rounded-xl bg-muted overflow-hidden shrink-0">
              {product.image_url
                ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-6 h-6 text-muted-foreground/40" /></div>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm line-clamp-2">{product.name ?? 'Product'}</p>
              <p className="text-xl font-black text-primary mt-0.5">${total.toFixed(2)}</p>
              <p className="text-[11px] text-muted-foreground">${unit.toFixed(2)} × {order.quantity ?? 1} unit{(order.quantity ?? 1) !== 1 ? 's' : ''}</p>
            </div>
          </div>

          {/* Status badge */}
          <div className="flex items-center gap-2">
            <StatusBadge status={order.status ?? 'confirmed'} />
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
            </span>
          </div>

          {/* Other party */}
          <div className="p-3 rounded-2xl border border-border">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{isSeller ? 'Buyer' : 'Seller'}</p>
            <div className="flex items-center gap-3">
              <button onClick={() => { navigate(`/profile/${other.username}`); onClose(); }}
                className="flex items-center gap-2 flex-1 hover:opacity-80 transition-opacity">
                <div className="w-9 h-9 rounded-full bg-muted overflow-hidden shrink-0">
                  {other.avatar_url
                    ? <img src={other.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{other.username?.[0]?.toUpperCase()}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-sm">@{other.username}</span>
                    {other.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary" />}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Tap to view profile</p>
                </div>
              </button>
              <button onClick={handleDM}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-full text-xs font-bold transition-colors shrink-0">
                <MessageSquare className="w-3.5 h-3.5" /> Message
              </button>
            </div>
          </div>

          {/* Buyer note */}
          {order.note && (
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">Note from buyer</p>
              <p className="text-sm italic text-foreground">"{order.note}"</p>
            </div>
          )}

          {/* Order timeline */}
          <div className="p-3 rounded-2xl border border-border">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Order Timeline</p>
            <div className="space-y-3">
              {timeline.map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${step.done ? 'bg-green-500/15 text-green-600' : 'bg-muted text-muted-foreground/40'}`}>
                    {step.icon === 'confirmed'  && <CheckCircle2 className="w-3.5 h-3.5" />}
                    {step.icon === 'shipped'    && <Truck        className="w-3.5 h-3.5" />}
                    {step.icon === 'delivered'  && <Package      className="w-3.5 h-3.5" />}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${step.done ? 'text-foreground' : 'text-muted-foreground/50'}`}>{step.label}</p>
                    {step.date && (
                      <p className="text-[10px] text-muted-foreground">{format(new Date(step.date), 'MMM d, yyyy · h:mm a')}</p>
                    )}
                  </div>
                  {i < timeline.length - 1 && (
                    <div className={`absolute ml-3.5 mt-7 w-0.5 h-3 ${step.done ? 'bg-green-500/30' : 'bg-border'}`} style={{ position: 'relative', left: '10px', marginLeft: '-22px', marginTop: '28px' }} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Seller note */}
          {order.seller_note && (
            <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1">Seller note</p>
              <p className="text-sm text-foreground">{order.seller_note}</p>
            </div>
          )}

          {/* Seller action buttons */}
          {isSeller && order.status === 'confirmed' && (
            <button onClick={() => handleStatusChange('shipped')} disabled={updating}
              className="w-full flex items-center justify-center gap-2 py-3 bg-amber-500 text-white rounded-2xl font-bold hover:bg-amber-600 transition-colors disabled:opacity-50">
              {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
              Mark as Shipped
            </button>
          )}
          {isSeller && order.status === 'shipped' && (
            <button onClick={() => handleStatusChange('delivered')} disabled={updating}
              className="w-full flex items-center justify-center gap-2 py-3 bg-green-500 text-white rounded-2xl font-bold hover:bg-green-600 transition-colors disabled:opacity-50">
              {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Mark as Delivered
            </button>
          )}

          {/* View full orders */}
          <button onClick={() => { navigate('/orders'); onClose(); }}
            className="w-full py-2.5 border border-border rounded-xl text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors flex items-center justify-center gap-1.5">
            <ShoppingCart className="w-4 h-4" /> View All Orders
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Seller Earnings Chart ────────────────────────────────────────────────────
function SellerEarningsChart({ sales }: { sales: any[] }) {
  // Build 7-day revenue chart from sales orders
  const days: string[] = [];
  const labels: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = subDays(new Date(), i);
    days.push(format(d, 'yyyy-MM-dd'));
    labels.push(format(d, 'MM/dd'));
  }
  const revenue = days.map(day =>
    sales
      .filter(o => format(new Date(o.created_at), 'yyyy-MM-dd') === day)
      .reduce((s, o) => s + Number(o.total_amount ?? 0), 0)
  );
  const hasData = revenue.some(v => v > 0);
  const chartData = days.map((_, i) => ({ date: labels[i], revenue: revenue[i] }));
  const maxRev = Math.max(...revenue, 0.01);

  return (
    <div className="p-4 rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-green-500" />
        <p className="font-bold text-sm">Revenue — Last 7 Days</p>
        <span className="text-[10px] text-muted-foreground ml-auto">
          ${revenue.reduce((s, v) => s + v, 0).toFixed(2)} total
        </span>
      </div>
      {hasData ? (
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
            <YAxis hide />
            <Tooltip
              formatter={(v: any) => [`$${Number(v).toFixed(2)}`, 'Revenue']}
              contentStyle={{ fontSize: 11, borderRadius: 8, padding: '4px 10px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))' }}
            />
            <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.revenue > 0 ? '#22c55e' : 'hsl(var(--muted))'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-20 text-muted-foreground text-xs">
          No revenue in the last 7 days
        </div>
      )}
    </div>
  );
}

// ── Quick Review Dialog ─────────────────────────────────────────────────────
function ReviewDialog({ order, onClose, onDone }: {
  order: any; onClose: () => void; onDone: () => void;
}) {
  const { user } = useAuth();
  const product = order.products ?? {};
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [hover, setHover] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!user || !rating) { toast.error('Please select a star rating'); return; }
    setSubmitting(true);
    const { error } = await supabase.from('product_reviews').upsert(
      { product_id: product.id, user_id: user.id, rating, comment: comment.trim() || null },
      { onConflict: 'product_id,user_id' }
    );
    if (error) { toast.error(error.message); setSubmitting(false); return; }
    toast.success('Review submitted! ⭐');
    onDone();
  };

  return (
    <div className="fixed inset-0 z-[400] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="font-bold text-base">Leave a Review</h3>
            <p className="text-xs text-muted-foreground line-clamp-1">{product.name}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Product preview */}
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-muted/40 border border-border">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="w-12 h-12 rounded-xl object-cover shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0"><ShoppingBag className="w-5 h-5 text-muted-foreground" /></div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm truncate">{product.name}</p>
              <p className="text-xs text-muted-foreground">Purchased {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}</p>
            </div>
          </div>

          {/* Star rating */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Your Rating</p>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map(i => (
                <button key={i}
                  onClick={() => setRating(i)}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(0)}
                  className="transition-transform hover:scale-110 active:scale-95">
                  <Star className={`w-8 h-8 transition-colors ${i <= (hover || rating) ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30'}`} />
                </button>
              ))}
              {(hover || rating) > 0 && (
                <span className="text-sm font-semibold text-amber-600 ml-1">
                  {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][hover || rating]}
                </span>
              )}
            </div>
          </div>

          {/* Comment */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Comment (optional)</p>
            <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} maxLength={400}
              placeholder="Share your experience with this product…"
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          <button onClick={handleSubmit} disabled={submitting || !rating}
            className="w-full py-3.5 bg-primary text-primary-foreground rounded-2xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            {submitting ? 'Submitting…' : `Submit ${rating > 0 ? `${rating}-Star ` : ''}Review`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Order Card — Buyer view ────────────────────────────────────────────────
function BuyerOrderCard({ order, navigate, onReview, onDetail }: {
  order: any; navigate: (p: string) => void; onReview: (order: any) => void; onDetail: (order: any) => void;
}) {
  const { user } = useAuth();
  const product   = order.products ?? {};
  const seller    = order.seller   ?? {};
  const total     = Number(order.total_amount ?? 0);
  const unit      = Number(order.unit_price   ?? 0);
  const [reviewed, setReviewed] = useState(false);

  // Check if already reviewed
  useEffect(() => {
    if (!user || order.status !== 'delivered') return;
    supabase.from('product_reviews').select('id')
      .eq('product_id', product.id).eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (data) setReviewed(true); });
  }, [order.status, product.id, user?.id]);

  const handleDM = async () => {
    if (!seller.id || !user) return;
    const { data: existing } = await supabase
      .from('conversations').select('id')
      .or(`and(participant_1.eq.${order.buyer_id},participant_2.eq.${seller.id}),and(participant_1.eq.${seller.id},participant_2.eq.${order.buyer_id})`)
      .maybeSingle();
    if (existing?.id) { navigate(`/messages?conv=${existing.id}`); return; }
    const { data: conv } = await supabase.from('conversations')
      .insert({ participant_1: order.buyer_id, participant_2: seller.id }).select('id').single();
    if (conv?.id) navigate(`/messages?conv=${conv.id}`);
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
      <button className="w-full text-left" onClick={() => onDetail(order)}>
      <div className="flex gap-3 p-4">
        {/* Product image */}
        <div className="w-20 h-20 rounded-xl bg-muted overflow-hidden shrink-0">
          {product.image_url
            ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-7 h-7 text-muted-foreground/40" /></div>}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-bold text-sm leading-snug line-clamp-2 flex-1">{product.name ?? 'Product'}</p>
            <StatusBadge status={order.status ?? 'confirmed'} />
          </div>
          <p className="text-xl font-black text-primary mt-1">${total.toFixed(2)}</p>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
            <span>${unit.toFixed(2)} × {order.quantity ?? 1}</span>
            <span>·</span>
            <span>{formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}</span>
          </div>
          {order.note && (
            <p className="mt-1.5 text-xs text-muted-foreground italic line-clamp-2">"{order.note}"</p>
          )}
          <p className="text-[10px] text-primary font-semibold mt-1">Tap for details →</p>
        </div>
      </div>
      </button>

      {/* Seller row + actions */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/20">
        <button onClick={() => navigate(`/seller/${seller.username}`)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-6 h-6 rounded-full bg-muted overflow-hidden shrink-0">
            {seller.avatar_url
              ? <img src={seller.avatar_url} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-[9px] font-bold">{seller.username?.[0]?.toUpperCase()}</div>}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold">@{seller.username}</span>
            {seller.verified && <BadgeCheck className="w-3 h-3 text-primary" />}
          </div>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        </button>

        <button onClick={handleDM}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-full text-xs font-bold transition-colors">
          <MessageSquare className="w-3.5 h-3.5" /> Message Seller
        </button>
      </div>

      {/* Review CTA — only for delivered orders not yet reviewed */}
      {order.status === 'delivered' && !reviewed && (
        <div className="px-4 py-3 border-t border-border bg-amber-500/[0.04]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">How was your purchase?</p>
            </div>
            <button onClick={() => onReview(order)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-full text-xs font-bold hover:bg-amber-600 transition-colors shrink-0">
              <Star className="w-3 h-3" /> Review
            </button>
          </div>
        </div>
      )}
      {order.status === 'delivered' && reviewed && (
        <div className="px-4 py-2.5 border-t border-border">
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="text-xs font-semibold">You reviewed this product</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Order Card — Seller view ───────────────────────────────────────────────
function SellerOrderCard({ order, onStatusUpdate, navigate, onDetail }: {
  order: any; onStatusUpdate: (id: string, status: string) => void; navigate: (p: string) => void; onDetail: (order: any) => void;
}) {
  const product = order.products ?? {};
  const buyer   = order.buyer   ?? {};
  const total   = Number(order.total_amount ?? 0);
  const [updating, setUpdating] = useState(false);
  const { user } = useAuth();

  const handleStatusChange = async (newStatus: string) => {
    setUpdating(true);
    const { error } = await supabase
      .from('orders')
      .update({
        status: newStatus,
        ...(newStatus === 'shipped'   ? { shipped_at:   new Date().toISOString() } : {}),
        ...(newStatus === 'delivered' ? { delivered_at: new Date().toISOString() } : {}),
      })
      .eq('id', order.id);
    if (error) { toast.error(error.message); setUpdating(false); return; }

    // Notify buyer in-app
    await supabase.from('notifications').insert({ recipient_id: order.buyer_id, kind: 'payment_sent', actor_id: order.seller_id,
     }).catch(() => {});

    // Send push notification to buyer
    const notifTitle = newStatus === 'shipped' ? '📦 Order Shipped!' : '✅ Order Delivered!';
    const notifBody  = newStatus === 'shipped'
      ? `Your order for "${product.name ?? 'your item'}" has been shipped by the seller.`
      : `Your order for "${product.name ?? 'your item'}" has been marked as delivered!`;

    supabase.functions.invoke('send-push-notification', {
      body: {
        user_id: order.buyer_id,
        title:   notifTitle,
        body:    notifBody,
        data: { route: '/orders', type: 'order_status' },
      },
    }).catch(() => {});

    toast.success(`Order marked as ${newStatus}`);
    onStatusUpdate(order.id, newStatus);
    setUpdating(false);
  };

  const handleDMBuyer = async () => {
    if (!buyer.id || !user) return;
    const { data: existing } = await supabase
      .from('conversations').select('id')
      .or(`and(participant_1.eq.${order.seller_id},participant_2.eq.${buyer.id}),and(participant_1.eq.${buyer.id},participant_2.eq.${order.seller_id})`)
      .maybeSingle();
    if (existing?.id) { navigate(`/messages?conv=${existing.id}`); return; }
    const { data: conv } = await supabase.from('conversations')
      .insert({ participant_1: order.seller_id, participant_2: buyer.id }).select('id').single();
    if (conv?.id) navigate(`/messages?conv=${conv.id}`);
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
      <button className="w-full text-left" onClick={() => onDetail(order)}>
      <div className="flex gap-3 p-4">
        {/* Product image */}
        <div className="w-20 h-20 rounded-xl bg-muted overflow-hidden shrink-0">
          {product.image_url
            ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-7 h-7 text-muted-foreground/40" /></div>}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-bold text-sm leading-snug line-clamp-2 flex-1">{product.name ?? 'Product'}</p>
            <StatusBadge status={order.status ?? 'confirmed'} />
          </div>
          <p className="text-xl font-black text-primary mt-1">${total.toFixed(2)}</p>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
            <span>Qty: {order.quantity ?? 1}</span>
            <span>·</span>
            <span>{formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}</span>
          </div>
          {order.note && (
            <p className="mt-1.5 text-xs text-muted-foreground italic line-clamp-2">Buyer: "{order.note}"</p>
          )}
          <p className="text-[10px] text-primary font-semibold mt-1">Tap for details →</p>
        </div>
      </div>
      </button>

      {/* Buyer row */}
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

        <button onClick={handleDMBuyer}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-full text-xs font-bold transition-colors">
          <MessageSquare className="w-3.5 h-3.5" /> Message Buyer
        </button>
      </div>

      {/* Seller action buttons */}
      {order.status === 'confirmed' && (
        <div className="flex gap-2 px-4 py-3 border-t border-border">
          <button onClick={() => handleStatusChange('shipped')} disabled={updating}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold hover:bg-amber-600 transition-colors disabled:opacity-50">
            {updating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
            Mark Shipped
          </button>
        </div>
      )}
      {order.status === 'shipped' && (
        <div className="flex gap-2 px-4 py-3 border-t border-border">
          <button onClick={() => handleStatusChange('delivered')} disabled={updating}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-500 text-white rounded-xl text-xs font-bold hover:bg-green-600 transition-colors disabled:opacity-50">
            {updating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Mark Delivered
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState('purchases' as 'purchases' | 'sales');
  const [purchases, setPurchases] = useState([] as any[]);
  const [sales,     setSales]     = useState([] as any[]);
  const [loadingP,  setLoadingP]  = useState(true);
  const [loadingS,  setLoadingS]  = useState(true);

  // Search & filter
  const [purchaseSearch,  setPurchaseSearch]  = useState('');
  const [saleSearch,      setSaleSearch]      = useState('');
  const [purchaseFilter,  setPurchaseFilter]  = useState('all' as FilterTab);
  const [saleFilter,      setSaleFilter]      = useState('all' as FilterTab);

  // Review dialog
  const [reviewOrder, setReviewOrder] = useState(null as any);
  // Detail sheet
  const [detailOrder, setDetailOrder] = useState(null as any);

  useSEO({ noindex: true, title: 'My Orders — Testagram', url: '/orders' });

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    fetchPurchases();
    fetchSales();
  }, [user]);

  const fetchPurchases = async () => {
    if (!user) return;
    setLoadingP(true);
    const { data, error } = await supabase
      .from('orders')
      .select('*, products(id, name, image_url, price, external_link), seller:profiles!orders_seller_id_profiles_fkey(id, username, avatar_url, verified)')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false });
    if (error) { toast.error('Failed to load purchases'); setLoadingP(false); return; }
    setPurchases(data ?? []);
    setLoadingP(false);
  };

  const fetchSales = async () => {
    if (!user) return;
    setLoadingS(true);
    const { data, error } = await supabase
      .from('orders')
      .select('*, products(id, name, image_url, price), buyer:profiles!orders_buyer_id_profiles_fkey(id, username, avatar_url, verified)')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false });
    if (error) { toast.error('Failed to load sales'); setLoadingS(false); return; }
    setSales(data ?? []);
    setLoadingS(false);
  };

  const handleStatusUpdate = (orderId: string, newStatus: string) => {
    setSales(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
  };

  // Filtered lists
  const filteredPurchases = purchases.filter(o => {
    const matchStatus = purchaseFilter === 'all' || o.status === purchaseFilter;
    const matchSearch = !purchaseSearch.trim() ||
      (o.products?.name ?? '').toLowerCase().includes(purchaseSearch.toLowerCase()) ||
      (o.seller?.username ?? '').toLowerCase().includes(purchaseSearch.toLowerCase());
    return matchStatus && matchSearch;
  });

  const filteredSales = sales.filter(o => {
    const matchStatus = saleFilter === 'all' || o.status === saleFilter;
    const matchSearch = !saleSearch.trim() ||
      (o.products?.name ?? '').toLowerCase().includes(saleSearch.toLowerCase()) ||
      (o.buyer?.username ?? '').toLowerCase().includes(saleSearch.toLowerCase());
    return matchStatus && matchSearch;
  });

  // Derived stats
  const totalSpent     = purchases.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
  const totalEarned    = sales.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
  const pendingSales   = sales.filter(o => o.status === 'confirmed').length;
  const shippedSales   = sales.filter(o => o.status === 'shipped').length;

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Orders" showBack />

      {/* ── Stats Hero ── */}
      <div className="grid grid-cols-2 gap-3 p-4 border-b border-border">
        <div className="p-4 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 cursor-pointer hover:from-primary/15 transition-all"
          onClick={() => setTab('purchases')}>
          <ShoppingCart className="w-5 h-5 text-primary mb-2" />
          <p className="text-2xl font-black text-primary">{purchases.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Purchases</p>
          <p className="text-sm font-bold mt-1">${totalSpent.toFixed(2)} total</p>
        </div>
        <div className="p-4 rounded-2xl bg-gradient-to-br from-green-500/10 to-green-500/5 border border-green-500/20 cursor-pointer hover:from-green-500/15 transition-all"
          onClick={() => setTab('sales')}>
          <DollarSign className="w-5 h-5 text-green-600 mb-2" />
          <p className="text-2xl font-black text-green-600">{sales.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Sales</p>
          <p className="text-sm font-bold mt-1">${totalEarned.toFixed(2)} total</p>
        </div>
      </div>

      {/* Alerts */}
      {tab === 'sales' && pendingSales > 0 && (
        <div className="mx-4 mt-4 flex items-center gap-3 px-4 py-3 bg-amber-500/[0.08] border border-amber-500/20 rounded-2xl">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{pendingSales} order{pendingSales !== 1 ? 's' : ''} need{pendingSales === 1 ? 's' : ''} action</p>
            <p className="text-xs text-muted-foreground">Mark orders as shipped to keep buyers informed</p>
          </div>
        </div>
      )}
      {tab === 'sales' && shippedSales > 0 && (
        <div className="mx-4 mt-3 flex items-center gap-3 px-4 py-3 bg-blue-500/[0.08] border border-blue-500/20 rounded-2xl">
          <Truck className="w-5 h-5 text-blue-500 shrink-0" />
          <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">
            {shippedSales} order{shippedSales !== 1 ? 's' : ''} in transit — mark as delivered when received
          </p>
        </div>
      )}

      {/* ── Main Tabs ── */}
      <div className="sticky top-14 z-20 bg-background border-b border-border flex">
        <button onClick={() => setTab('purchases')}
          className={`flex-1 py-3.5 text-sm font-semibold border-b-2 flex items-center justify-center gap-2 transition-colors ${
            tab === 'purchases' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40'
          }`}>
          <ShoppingCart className="w-4 h-4" />
          My Purchases
          {purchases.length > 0 && (
            <span className="text-[10px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded-full">{purchases.length}</span>
          )}
        </button>
        <button onClick={() => setTab('sales')}
          className={`flex-1 py-3.5 text-sm font-semibold border-b-2 flex items-center justify-center gap-2 transition-colors ${
            tab === 'sales' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40'
          }`}>
          <Package className="w-4 h-4" />
          My Sales
          {pendingSales > 0 ? (
            <span className="text-[10px] bg-amber-500/10 text-amber-600 font-bold px-1.5 py-0.5 rounded-full">{pendingSales} pending</span>
          ) : sales.length > 0 ? (
            <span className="text-[10px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded-full">{sales.length}</span>
          ) : null}
        </button>
      </div>

      {/* ── Purchases Tab ── */}
      {tab === 'purchases' && (
        <div className="p-4 space-y-3">
          {/* Search + Filter */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input value={purchaseSearch} onChange={e => setPurchaseSearch(e.target.value)}
                placeholder="Search purchases…"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm" />
              {purchaseSearch && (
                <button onClick={() => setPurchaseSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
              {FILTER_TABS.map(f => (
                <button key={f} onClick={() => setPurchaseFilter(f)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                    purchaseFilter === f ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'
                  }`}>
                  {f === 'confirmed'  && <Clock className="w-3 h-3" />}
                  {f === 'shipped'    && <Truck className="w-3 h-3" />}
                  {f === 'delivered'  && <CheckCircle2 className="w-3 h-3" />}
                  {FILTER_LABELS[f]}
                  {f !== 'all' && purchases.filter(o => o.status === f).length > 0 && (
                    <span className="bg-white/20 px-1 rounded-full">{purchases.filter(o => o.status === f).length}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {loadingP ? (
            <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
          ) : filteredPurchases.length === 0 ? (
            <div className="text-center py-20">
              <ShoppingCart className="w-16 h-16 text-muted-foreground/20 mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">{purchases.length === 0 ? 'No purchases yet' : 'No results'}</h2>
              <p className="text-sm text-muted-foreground mb-5">
                {purchases.length === 0 ? 'Browse the marketplace and place your first order' : 'Try adjusting your search or filter'}
              </p>
              {purchases.length === 0 && (
                <button onClick={() => navigate('/marketplace')}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-full font-semibold text-sm hover:opacity-90 mx-auto">
                  <ShoppingBag className="w-4 h-4" /> Browse Marketplace
                </button>
              )}
            </div>
          ) : (
            filteredPurchases.map(order => (
              <BuyerOrderCard key={order.id} order={order} navigate={navigate} onReview={setReviewOrder} onDetail={setDetailOrder} />
            ))
          )}
        </div>
      )}

      {/* ── Sales Tab ── */}
      {tab === 'sales' && (
        <div className="p-4 space-y-3">
          {/* Search + Filter */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input value={saleSearch} onChange={e => setSaleSearch(e.target.value)}
                placeholder="Search orders…"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm" />
              {saleSearch && (
                <button onClick={() => setSaleSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
              {FILTER_TABS.map(f => (
                <button key={f} onClick={() => setSaleFilter(f)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                    saleFilter === f ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'
                  }`}>
                  {f === 'confirmed'  && <Clock className="w-3 h-3" />}
                  {f === 'shipped'    && <Truck className="w-3 h-3" />}
                  {f === 'delivered'  && <CheckCircle2 className="w-3 h-3" />}
                  {FILTER_LABELS[f]}
                  {f !== 'all' && sales.filter(o => o.status === f).length > 0 && (
                    <span className="bg-white/20 px-1 rounded-full">{sales.filter(o => o.status === f).length}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Earnings chart — shown when no search/filter active */}
          {!saleSearch && saleFilter === 'all' && sales.length > 0 && (
            <SellerEarningsChart sales={sales} />
          )}

          {loadingS ? (
            <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
          ) : filteredSales.length === 0 ? (
            <div className="text-center py-20">
              <Package className="w-16 h-16 text-muted-foreground/20 mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">{sales.length === 0 ? 'No sales yet' : 'No results'}</h2>
              <p className="text-sm text-muted-foreground mb-5">
                {sales.length === 0 ? 'List products to start selling on Testagram' : 'Try adjusting your search or filter'}
              </p>
              {sales.length === 0 && (
                <button onClick={() => navigate('/products')}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-full font-semibold text-sm hover:opacity-90 mx-auto">
                  <Package className="w-4 h-4" /> Manage Products
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Sort: pending first */}
              {[...filteredSales]
                .sort((a, b) => {
                  const order = ['confirmed', 'shipped', 'delivered', 'cancelled'];
                  return (order.indexOf(a.status) - order.indexOf(b.status))
                    || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                })
                .map(order => (
                  <SellerOrderCard
                    key={order.id}
                    order={order}
                    onStatusUpdate={handleStatusUpdate}
                    navigate={navigate}
                    onDetail={setDetailOrder}
                  />
                ))
              }
              {/* Revenue summary */}
              {saleFilter === 'all' && !saleSearch && (
                <div className="mt-4 p-4 rounded-2xl bg-gradient-to-br from-green-500/10 to-green-500/5 border border-green-500/20">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Revenue Summary</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center">
                      <p className="text-xl font-black text-green-600">${totalEarned.toFixed(2)}</p>
                      <p className="text-[10px] text-muted-foreground">Total</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-black">{sales.filter(o => o.status === 'delivered').length}</p>
                      <p className="text-[10px] text-muted-foreground">Delivered</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-black text-amber-600">{pendingSales}</p>
                      <p className="text-[10px] text-muted-foreground">Pending</p>
                    </div>
                  </div>
                  <button onClick={() => navigate('/monetization')}
                    className="mt-3 w-full py-2 border border-green-500/30 rounded-xl text-xs font-bold text-green-700 dark:text-green-400 hover:bg-green-500/10 transition-colors flex items-center justify-center gap-1.5">
                    <Star className="w-3.5 h-3.5" /> View Monetization Dashboard <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Order Detail Sheet */}
      {detailOrder && (
        <OrderDetailSheet
          order={detailOrder}
          isSeller={tab === 'sales'}
          onClose={() => setDetailOrder(null)}
          navigate={navigate}
          onStatusUpdate={(id, status) => {
            handleStatusUpdate(id, status);
            setDetailOrder((prev: any) => prev ? { ...prev, status } : null);
          }}
        />
      )}

      {/* Review Dialog */}
      {reviewOrder && (
        <ReviewDialog
          order={reviewOrder}
          onClose={() => setReviewOrder(null)}
          onDone={() => {
            setReviewOrder(null);
            // Refresh to update review status
            fetchPurchases();
          }}
        />
      )}
    </div>
  );
}
