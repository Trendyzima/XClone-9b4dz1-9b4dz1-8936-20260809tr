
import { useState, useEffect, useRef } from 'react';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingBag, Plus, Edit, Trash2, ExternalLink, Search,
  Star, TrendingUp, Eye, Package, Tag, Heart, Sparkles, BadgeCheck,
  ChevronRight, ArrowLeft, X, Check, Loader2, Grid3x3, LayoutList,
  MessageSquare, Send, HelpCircle, DollarSign, ChevronDown, ChevronUp,
  Megaphone, MapPin, Store
} from 'lucide-react';
import { toast } from 'sonner';
import { TopBar } from '@/components/layout/TopBar';
import { useSEO } from '@/hooks/useSEO';

// ── Star Rating Display ─────────────────────────────────────────────────────
function StarRating({ rating, size = 'sm', interactive = false, onRate }: {
  rating: number; size?: 'sm' | 'md'; interactive?: boolean; onRate?: (r: number) => void;
}) {
  const [hover, setHover] = useState(0);
  const s = size === 'md' ? 'w-5 h-5' : 'w-3.5 h-3.5';
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <button key={i} disabled={!interactive} onClick={() => onRate?.(i)}
          onMouseEnter={() => interactive && setHover(i)} onMouseLeave={() => interactive && setHover(0)}
          className={interactive ? 'cursor-pointer transition-transform hover:scale-110' : 'cursor-default'}>
          <Star className={`${s} transition-colors ${i <= (hover || rating) ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30'}`} />
        </button>
      ))}
    </div>
  );
}

// ── Tip Modal ────────────────────────────────────────────────────────────────
function TipProductModal({ seller, onClose }: { seller: any; onClose: () => void }) {
  const { user } = useAuth();
  const [tipAmount, setTipAmount] = useState(0);
  const [custom, setCustom] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const sendTip = async () => {
    if (!user) { toast.error('Sign in to send a tip'); return; }
    const amt = tipAmount || Number(custom);
    if (!amt || amt <= 0) { toast.error('Enter a tip amount'); return; }
    setSending(true);
    const { error } = await supabase.rpc('send_wallet_tip', {
      p_to_user_id: seller.id,
      p_amount: amt,
      p_note: 'Marketplace tip',
    });
    if (error) {
      toast.error(error.message.includes('INSUFFICIENT_FUNDS') ? 'Insufficient wallet balance' : error.message);
      setSending(false);
      return;
    }
    toast.success(`$${amt.toFixed(2)} tip sent to @${seller.username}!`);
    setSent(true);
    setSending(false);
    setTimeout(onClose, 1500);
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-background w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-lg">Send a Tip</h3>
            <p className="text-sm text-muted-foreground">to @{seller?.username}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>
        {sent ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-2">💰</div>
            <p className="font-bold text-green-600">Tip Sent!</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[1, 5, 10].map(a => (
                <button key={a} onClick={() => { setTipAmount(a); setCustom(''); }}
                  className={`py-3 rounded-xl font-bold text-base border-2 transition-all ${
                    tipAmount === a ? 'border-yellow-500 bg-yellow-500/10 text-yellow-600' : 'border-border hover:border-yellow-500/40'
                  }`}>${a}</button>
              ))}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
              <input type="number" min="0.01" step="0.01" placeholder="Custom amount"
                value={custom} onChange={e => { setCustom(e.target.value); setTipAmount(0); }}
                className="w-full pl-8 pr-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
              />
            </div>
            <button onClick={sendTip} disabled={sending || (!tipAmount && !Number(custom))}
              className="w-full py-3.5 bg-gradient-to-r from-yellow-500 to-amber-500 text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
              {sending ? 'Sending…' : `Send $${(tipAmount || Number(custom) || 0).toFixed(2)} Tip`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Product Q&A Modal ─────────────────────────────────────────────────────────
function ProductQAModal({ product, onClose }: { product: any; onClose: () => void }) {
  const { user } = useAuth();
  const [questions, setQuestions] = useState([] as any[]);
  const [loading, setLoading] = useState(true);
  const [newQ, setNewQ] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedIdsArr, setExpandedIdsArr] = useState([] as string[]);
  const [answerDraft, setAnswerDraft] = useState({} as { [key: string]: string });
  const [answeringId, setAnsweringId] = useState(null as string | null);
  const isSeller = user?.id === product.user_id;

  useEffect(() => { fetchQA(); }, [product.id]);

  const fetchQA = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('product_questions')
      .select('*, asker:asker_id(username, avatar_url), answerer:answered_by(username, avatar_url)')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false });
    setQuestions(data ?? []);
    setLoading(false);
  };

  const submitQuestion = async () => {
    if (!user) { toast.error('Sign in to ask a question'); return; }
    if (!newQ.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.from('product_questions').insert({ product_id: product.id, asker_id: user.id, question: newQ.trim() });
    if (error) toast.error(error.message);
    else { toast.success('Question submitted!'); setNewQ(''); fetchQA(); }
    setSubmitting(false);
  };

  const submitAnswer = async (qId: string) => {
    if (!isSeller) return;
    const ans = answerDraft[qId]?.trim();
    if (!ans) return;
    setAnsweringId(qId);
    const { error } = await supabase.from('product_questions').update({
      answer: ans, answered_by: user!.id, answered_at: new Date().toISOString()
    }).eq('id', qId);
    if (error) toast.error(error.message);
    else { toast.success('Answer posted!'); setAnswerDraft(prev => { const n = { ...prev }; delete n[qId]; return n; }); fetchQA(); }
    setAnsweringId(null);
  };

  return (
    <div className="fixed inset-0 z-[310] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-background w-full max-w-lg max-h-[90vh] rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <div>
            <h3 className="font-bold text-lg">Product Q&amp;A</h3>
            <p className="text-xs text-muted-foreground line-clamp-1">{product.name}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-muted flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1">
          {user && user.id !== product.user_id && (
            <div className="px-4 py-3 border-b border-border">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Ask the seller</p>
              <div className="flex gap-2">
                <textarea value={newQ} onChange={e => setNewQ(e.target.value)} placeholder="e.g. Do you ship internationally?"
                  rows={2} maxLength={300}
                  className="flex-1 px-3 py-2 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button onClick={submitQuestion} disabled={submitting || !newQ.trim()}
                  className="px-3 py-2 bg-primary text-primary-foreground rounded-xl font-bold text-sm disabled:opacity-50 self-end">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}
          {isSeller && questions.filter(q => !q.answer).length > 0 && (
            <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/20">
              <p className="text-xs font-semibold text-amber-600">{questions.filter(q => !q.answer).length} question{questions.filter(q => !q.answer).length !== 1 ? 's' : ''} waiting for your answer</p>
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : questions.length === 0 ? (
            <div className="text-center py-12">
              <HelpCircle className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="font-semibold text-sm">No questions yet</p>
              <p className="text-xs text-muted-foreground">Be the first to ask the seller</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {questions.map((q: any) => {
                const expanded = expandedIdsArr.includes(q.id);
                return (
                  <div key={q.id} className="px-4 py-3">
                    <button className="w-full text-left" onClick={() => setExpandedIdsArr(prev => prev.includes(q.id) ? prev.filter(x => x !== q.id) : [...prev, q.id])}>
                      <div className="flex items-start gap-2">
                        <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0 mt-0.5">
                          {q.asker?.avatar_url ? <img src={q.asker.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{q.asker?.username?.[0]?.toUpperCase()}</div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold">{q.asker?.username}</span>
                            <span className="text-[10px] text-muted-foreground">{new Date(q.created_at).toLocaleDateString()}</span>
                            {!q.answer && <span className="ml-auto text-[9px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded-full font-bold">Unanswered</span>}
                          </div>
                          <p className="text-sm font-medium mt-0.5 text-left">{q.question}</p>
                          {q.answer && !expanded && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">↳ {q.answer}</p>
                          )}
                        </div>
                        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                      </div>
                    </button>
                    {expanded && (
                      <div className="mt-2 ml-9 space-y-2">
                        {q.answer ? (
                          <div className="bg-primary/5 border border-primary/20 rounded-xl px-3 py-2">
                            <div className="flex items-center gap-1.5 mb-1">
                              <BadgeCheck className="w-3.5 h-3.5 text-primary" />
                              <span className="text-[11px] font-bold text-primary">Seller</span>
                              <span className="text-[10px] text-muted-foreground ml-auto">{q.answered_at ? new Date(q.answered_at).toLocaleDateString() : ''}</span>
                            </div>
                            <p className="text-sm">{q.answer}</p>
                          </div>
                        ) : isSeller ? (
                          <div className="space-y-1.5">
                            <textarea value={answerDraft[q.id] ?? ''}
                              onChange={e => setAnswerDraft(prev => ({ ...prev, [q.id]: e.target.value }))}
                              placeholder="Write your answer…" rows={2} maxLength={500}
                              className="w-full px-3 py-2 rounded-xl border border-primary/30 bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                            <button onClick={() => submitAnswer(q.id)} disabled={answeringId === q.id || !answerDraft[q.id]?.trim()}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-full text-xs font-bold disabled:opacity-50">
                              {answeringId === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Post Answer
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">Awaiting seller response…</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Product Reviews Modal ────────────────────────────────────────────────────
function ProductReviewsModal({ product, onClose }: { product: any; onClose: () => void }) {
  const { user } = useAuth();
  const [reviews, setReviews] = useState([] as any[]);
  const [loading, setLoading] = useState(true);
  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [myReview, setMyReview] = useState(null as any);

  useEffect(() => { fetchReviews(); }, [product.id]);

  const fetchReviews = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('product_reviews')
      .select('*, profiles(username, avatar_url, verified)')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false });
    const all = data ?? [];
    setReviews(all);
    if (user) {
      const mine = all.find((r: any) => r.user_id === user.id);
      if (mine) { setMyReview(mine); setMyRating(mine.rating); setMyComment(mine.comment ?? ''); }
    }
    setLoading(false);
  };

  const submitReview = async () => {
    if (!user) { toast.error('Sign in to leave a review'); return; }
    if (!myRating) { toast.error('Please select a star rating'); return; }
    setSubmitting(true);
    const payload = { product_id: product.id, user_id: user.id, rating: myRating, comment: myComment.trim() || null };
    if (myReview) {
      const { error } = await supabase.from('product_reviews').update({ rating: myRating, comment: myComment.trim() || null }).eq('id', myReview.id);
      if (error) toast.error(error.message); else { toast.success('Review updated'); fetchReviews(); }
    } else {
      const { error } = await supabase.from('product_reviews').insert(payload);
      if (error) toast.error(error.message); else { toast.success('Review submitted! ⭐'); fetchReviews(); }
    }
    setSubmitting(false);
  };

  const avgRating = reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) : 0;
  const dist = [5, 4, 3, 2, 1].map(n => ({ n, count: reviews.filter(r => r.rating === n).length }));

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-background w-full max-w-lg max-h-[90vh] rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <div>
            <h3 className="font-bold text-lg leading-tight line-clamp-1">{product.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <StarRating rating={Math.round(avgRating)} />
              <span className="text-sm font-bold">{avgRating.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">({reviews.length} review{reviews.length !== 1 ? 's' : ''})</span>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-muted flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1">
          {reviews.length > 0 && (
            <div className="px-4 py-3 border-b border-border">
              {dist.map(({ n, count }) => (
                <div key={n} className="flex items-center gap-2 py-0.5">
                  <span className="text-xs text-muted-foreground w-3">{n}</span>
                  <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full" style={{ width: reviews.length ? `${(count / reviews.length) * 100}%` : '0%' }} />
                  </div>
                  <span className="text-xs text-muted-foreground w-5 text-right">{count}</span>
                </div>
              ))}
            </div>
          )}
          {user && user.id !== product.user_id && (
            <div className="px-4 py-4 border-b border-border">
              <h4 className="font-semibold text-sm mb-3">{myReview ? 'Update Your Review' : 'Write a Review'}</h4>
              <StarRating rating={myRating} size="md" interactive onRate={setMyRating} />
              <textarea value={myComment} onChange={e => setMyComment(e.target.value)}
                placeholder="Share your experience (optional)…" rows={3} maxLength={400}
                className="w-full mt-3 px-3 py-2.5 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button onClick={submitReview} disabled={submitting || !myRating}
                className="mt-2 flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-bold disabled:opacity-50">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {myReview ? 'Update' : 'Submit Review'}
              </button>
            </div>
          )}
          <div className="divide-y divide-border">
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : reviews.length === 0 ? (
              <div className="text-center py-12">
                <MessageSquare className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="font-semibold text-sm">No reviews yet</p>
                <p className="text-xs text-muted-foreground">Be the first to share your experience</p>
              </div>
            ) : reviews.map((r: any) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
                    {r.user_profiles?.avatar_url ? <img src={r.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-xs">{r.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm">{r.user_profiles?.username}</span>
                      {r.user_profiles?.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary" />}
                      <span className="text-xs text-muted-foreground ml-auto">{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                    <StarRating rating={r.rating} />
                    {r.comment && <p className="text-sm text-foreground mt-1">{r.comment}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Module-level category/region config (esbuild-safe) ─────────────────────
const PROD_CATEGORIES = [
  { id: 'other',       emoji: '📦', label: 'Other'       },
  { id: 'digital',     emoji: '💻', label: 'Digital'     },
  { id: 'handmade',    emoji: '🧵', label: 'Handmade'    },
  { id: 'fashion',     emoji: '👗', label: 'Fashion'     },
  { id: 'art',         emoji: '🎨', label: 'Art'         },
  { id: 'food',        emoji: '🍜', label: 'Food'        },
  { id: 'electronics', emoji: '📱', label: 'Electronics' },
  { id: 'books',       emoji: '📚', label: 'Books'       },
  { id: 'beauty',      emoji: '💄', label: 'Beauty'      },
  { id: 'home',        emoji: '🏠', label: 'Home'        },
  { id: 'sports',      emoji: '⚽', label: 'Sports'      },
  { id: 'music',       emoji: '🎵', label: 'Music'       },
  { id: 'toys',        emoji: '🧸', label: 'Toys'        },
];

const PROD_REGIONS = [
  { id: 'all',          flag: '🌍', label: 'Worldwide'     },
  { id: 'kenya',        flag: '🇰🇪', label: 'Kenya'         },
  { id: 'nigeria',      flag: '🇳🇬', label: 'Nigeria'       },
  { id: 'ghana',        flag: '🇬🇭', label: 'Ghana'         },
  { id: 'south_africa', flag: '🇿🇦', label: 'South Africa'  },
  { id: 'us',           flag: '🇺🇸', label: 'United States' },
  { id: 'uk',           flag: '🇬🇧', label: 'United Kingdom'},
  { id: 'europe',       flag: '🇪🇺', label: 'Europe'        },
  { id: 'asia',         flag: '🌏', label: 'Asia'          },
];

// ── Product Boost to Feed Dialog ─────────────────────────────────────────────
function ProductBoostDialog({ product, onClose }: { product: any; onClose: () => void }) {
  const { user } = useAuth();
  const [budget, setBudget] = useState('');
  const [days, setDays] = useState('7');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const BOOST_BUDGETS = ['5', '10', '25', '50'];
  const BOOST_DAYS    = ['3', '7', '14', '30'];

  const handleBoost = async () => {
    if (!user) return;
    const budgetNum = Number(budget);
    if (!budgetNum || budgetNum < 1) { toast.error('Enter a valid budget'); return; }
    setSubmitting(true);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + Number(days) * 86400000);
    const { error } = await supabase.from('user_ads').insert({
      user_id: user.id,
      title: product.name,
      description: product.description || `Shop ${product.name} — Available on Testagram Marketplace`,
      image_url: product.image_url ?? null,
      target_url: product.external_link || `${window.location.origin}/marketplace`,
      budget: budgetNum,
      status: 'pending',
      payment_status: 'pending',
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
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
            <p className="text-sm text-muted-foreground">Your product will be reviewed and organically distributed across feeds soon.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="font-bold text-base flex items-center gap-2"><Megaphone className="w-4 h-4 text-amber-500" /> Promote to Feed</h3>
                <p className="text-xs text-muted-foreground line-clamp-1">{product.name}</p>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-muted/40 border border-border">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0"><ShoppingBag className="w-5 h-5 text-muted-foreground" /></div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">{product.name}</p>
                  <p className="text-base font-black text-primary">${Number(product.price).toFixed(2)}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Budget</p>
                <div className="flex gap-2 mb-2 flex-wrap">
                  {BOOST_BUDGETS.map(b => (
                    <button key={b} onClick={() => setBudget(b)}
                      className={`px-3 py-1.5 rounded-xl border text-sm font-bold transition-all ${
                        budget === b ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'
                      }`}>${b}</button>
                  ))}
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
                  <input type="number" min="1" value={budget} onChange={e => setBudget(e.target.value)} placeholder="Custom"
                    className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Duration</p>
                <div className="flex gap-2">
                  {BOOST_DAYS.map(d => (
                    <button key={d} onClick={() => setDays(d)}
                      className={`flex-1 py-2 rounded-xl border text-sm font-bold transition-all ${
                        days === d ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'
                      }`}>{d}d</button>
                  ))}
                </div>
              </div>
              <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-500/8 border border-amber-500/20 rounded-xl">
                <Megaphone className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">Your product ad is organically distributed via our ad algorithm across feeds, stories, and relevant placements after review.</p>
              </div>
              <button onClick={handleBoost} disabled={submitting || !budget}
                className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Megaphone className="w-5 h-5" />}
                {submitting ? 'Submitting…' : `Boost · $${budget || '—'} · ${days} days`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type ViewMode = 'marketplace' | 'my-products' | 'add-product' | 'edit-product';
type GridMode = 'grid' | 'list';

export function ProductsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState('marketplace' as ViewMode);
  const [gridMode, setGridMode] = useState('grid' as GridMode);
  const [allProducts, setAllProducts] = useState([] as any[]);
  const [myProducts, setMyProducts] = useState([] as any[]);
  const [featuredProducts, setFeaturedProducts] = useState([] as any[]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingProduct, setEditingProduct] = useState(null as any);
  const [reviewProduct, setReviewProduct] = useState(null as any);
  const [qaProduct, setQaProduct] = useState(null as any);
  const [tipSeller, setTipSeller] = useState(null as any);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formLink, setFormLink] = useState('');
  const [formImage, setFormImage] = useState('');
  const [formStock, setFormStock] = useState('');
  const [formCategory, setFormCategory] = useState('other');
  const [formRegion, setFormRegion] = useState('all');
  const [saving, setSaving] = useState(false);
  const [boostingProduct, setBoostingProduct] = useState(null as any);

  // Wishlist — stored as string array (esbuild guard: no Set<string> in state)
  const [wishlistArr, setWishlistArr] = useState([] as string[]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('product_wishlist_v2');
      if (raw) setWishlistArr(JSON.parse(raw) as string[]);
    } catch { }
  }, []);

  useEffect(() => {
    try { localStorage.setItem('product_wishlist_v2', JSON.stringify(wishlistArr)); } catch { }
  }, [wishlistArr]);

  const toggleWishlist = (id: string) => {
    setWishlistArr(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  useEffect(() => {
    fetchMarketplace();
    if (user) fetchMyProducts();
  }, [user]);

  const fetchMarketplace = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('products')
      .select('*, profiles(id, username, avatar_url, verified_tier)')
      .eq('is_active', true)
      .order('views_count', { ascending: false })
      .limit(80);
    const products = data ?? [];
    setAllProducts(products);
    setFeaturedProducts(products.filter((p: any) => p.is_featured).slice(0, 5));
    setLoading(false);
  };

  const fetchMyProducts = async () => {
    if (!user) return;
    const { data } = await supabase.from('products').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    setMyProducts(data ?? []);
  };

  const handleSaveProduct = async () => {
    if (!user) { navigate('/auth'); return; }
    if (!formName.trim() || !formPrice) { toast.error('Name and price are required'); return; }
    setSaving(true);
    const payload = {
      user_id: user.id,
      name: formName.trim(),
      description: formDesc.trim(),
      price: Number(formPrice),
      external_link: formLink.trim(),
      image_url: formImage.trim() || null,
      stock: formStock ? Number(formStock) : 0,
      is_active: true,
      category: formCategory,
      region: formRegion,
    };
    if (editingProduct) {
      const { error } = await supabase.from('products').update(payload).eq('id', editingProduct.id);
      if (error) toast.error(error.message);
      else { toast.success('Product updated'); resetForm(); setViewMode('my-products'); fetchMyProducts(); }
    } else {
      const { error } = await supabase.from('products').insert(payload);
      if (error) toast.error(error.message);
      else { toast.success('Product listed!'); resetForm(); setViewMode('my-products'); fetchMyProducts(); fetchMarketplace(); }
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this product?')) return;
    await supabase.from('products').delete().eq('id', id);
    toast.success('Deleted');
    fetchMyProducts();
  };

  const handleToggleActive = async (id: string, current: boolean) => {
    await supabase.from('products').update({ is_active: !current }).eq('id', id);
    fetchMyProducts();
  };

  const trackView = async (productId: string) => {
    await supabase.rpc('increment', { row_id: productId, table_name: 'products', column_name: 'views_count' }).catch(() => { });
  };

  const resetForm = () => {
    setFormName(''); setFormDesc(''); setFormPrice('');
    setFormLink(''); setFormImage('');
    setFormStock(''); setFormCategory('other'); setFormRegion('all');
    setEditingProduct(null);
  };

  const openEdit = (p: any) => {
    setEditingProduct(p);
    setFormName(p.name ?? '');
    setFormDesc(p.description ?? '');
    setFormPrice(String(p.price ?? ''));
    setFormLink(p.external_link ?? '');
    setFormImage(p.image_url ?? '');
    setFormStock(String(p.stock ?? ''));
    setFormCategory(p.category ?? 'other');
    setFormRegion(p.region ?? 'all');
    setViewMode('edit-product');
  };

  const filteredProducts = allProducts.filter(p => {
    if (!search) return true;
    return p.name?.toLowerCase().includes(search.toLowerCase()) || p.description?.toLowerCase().includes(search.toLowerCase());
  });

  // ── SEO — Marketplace with ItemList JSON-LD from featured products ───
  const productsJsonLd = featuredProducts.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Featured Products on Testagram Marketplace',
    description: 'Discover handpicked products from verified creators on Testagram',
    url: 'https://testagram.site/products',
    numberOfItems: featuredProducts.length,
    itemListElement: featuredProducts.map((p: any, i: number) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.name,
      url: p.external_link || `https://testagram.site/products`,
      description: p.description || p.name,
      image: p.image_url || undefined,
      offers: {
        '@type': 'Offer',
        price: Number(p.price).toFixed(2),
        priceCurrency: 'USD',
        availability: (p.stock ?? 1) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      },
    })),
  } : undefined;
  useSEO({
    title: 'Marketplace — Shop Creator Products',
    description: `Browse ${allProducts.length} products from verified creators on Testagram. Shop handmade items, digital goods, and exclusive creator merchandise.`,
    url: '/products',
    type: 'website',
    keywords: 'marketplace, creator products, shop, buy, testagram, handmade, digital goods, merchandise',
    structuredData: productsJsonLd,
  });

  // ── Add/Edit Form ─────────────────────────────────────────────────────────
  if (viewMode === 'add-product' || viewMode === 'edit-product') {
    return (
      <div className="max-w-2xl mx-auto pb-20">
        <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
          <div className="flex items-center gap-3 px-4 h-14">
            <button onClick={() => { resetForm(); setViewMode(editingProduct ? 'my-products' : 'marketplace'); }} className="p-2 hover:bg-muted rounded-full"><ArrowLeft className="w-5 h-5" /></button>
            <h1 className="text-xl font-bold">{editingProduct ? 'Edit Product' : 'List a Product'}</h1>
          </div>
        </div>
        <div className="p-4 space-y-4">
          {formImage && (
            <div className="relative w-full h-52 rounded-2xl overflow-hidden border border-border bg-muted">
              <img src={formImage} alt="preview" className="w-full h-full object-cover" />
              <button onClick={() => setFormImage('')} className="absolute top-2 right-2 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center text-white"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Product Name *</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Handmade Bracelet"
                className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-base" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Description</label>
              <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={3} placeholder="Describe your product…"
                className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-base resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Price (USD) *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
                  <input type="number" min="0" step="0.01" value={formPrice} onChange={e => setFormPrice(e.target.value)} placeholder="0.00"
                    className="w-full pl-8 pr-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Stock</label>
                <input type="number" min="0" value={formStock} onChange={e => setFormStock(e.target.value)} placeholder="∞"
                  className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Image URL</label>
              <input value={formImage} onChange={e => setFormImage(e.target.value)} placeholder="https://example.com/image.jpg"
                className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Buy Link (optional)</label>
              <input value={formLink} onChange={e => setFormLink(e.target.value)} placeholder="https://your-store.com/product"
                className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>

            {/* Category */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Category</label>
              <div className="flex flex-wrap gap-2">
                {PROD_CATEGORIES.map(c => (
                  <button key={c.id} type="button" onClick={() => setFormCategory(c.id)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                      formCategory === c.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/40'
                    }`}>
                    <span>{c.emoji}</span>{c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Region */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Region of Sale
              </label>
              <div className="flex flex-wrap gap-2">
                {PROD_REGIONS.map(r => (
                  <button key={r.id} type="button" onClick={() => setFormRegion(r.id)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                      formRegion === r.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/40'
                    }`}>
                    <span>{r.flag}</span>{r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button onClick={handleSaveProduct} disabled={saving || !formName.trim() || !formPrice}
            className="w-full py-4 bg-primary text-primary-foreground rounded-2xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
            {saving ? 'Saving…' : editingProduct ? 'Save Changes' : 'List Product'}
          </button>
        </div>
      </div>
    );
  }

  // ── My Products ───────────────────────────────────────────────────────────
  if (viewMode === 'my-products') {
    return (
      <div className="max-w-4xl mx-auto pb-20">
        <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
          <div className="flex items-center gap-3 px-4 h-14">
            <button onClick={() => setViewMode('marketplace')} className="p-2 hover:bg-muted rounded-full"><ArrowLeft className="w-5 h-5" /></button>
            <h1 className="text-xl font-bold">My Products</h1>
          </div>
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">{myProducts.length} product{myProducts.length !== 1 ? 's' : ''} listed</p>
            <div className="flex items-center gap-2">
              <button onClick={() => navigate('/wishlist')} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                <Heart className="w-3.5 h-3.5" /> Wishlist
              </button>
              <button onClick={() => { resetForm(); setViewMode('add-product'); }}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-full font-semibold text-sm hover:opacity-90 transition-opacity">
                <Plus className="w-4 h-4" /> Add Product
              </button>
            </div>
          </div>
          {myProducts.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto mb-4"><Package className="w-10 h-10 text-primary" /></div>
              <h2 className="text-xl font-bold mb-2">No products yet</h2>
              <p className="text-muted-foreground mb-5 text-sm">Create products to sell and tag them in your posts</p>
              <button onClick={() => { resetForm(); setViewMode('add-product'); }} className="px-6 py-2.5 bg-primary text-primary-foreground rounded-full font-semibold hover:opacity-90">
                List Your First Product
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {myProducts.map(product => (
                <div key={product.id} className={`rounded-2xl border border-border bg-card overflow-hidden ${!product.is_active ? 'opacity-60' : ''}`}>
                  <div className="flex gap-3 p-3">
                    {product.image_url ? <img src={product.image_url} alt={product.name} className="w-20 h-20 object-cover rounded-xl flex-shrink-0" />
                      : <div className="w-20 h-20 rounded-xl bg-muted flex items-center justify-center flex-shrink-0"><Package className="w-8 h-8 text-muted-foreground" /></div>}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-base leading-tight truncate">{product.name}</h3>
                        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-semibold ${product.is_active ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                          {product.is_active ? 'Live' : 'Hidden'}
                        </span>
                      </div>
                      <p className="text-xl font-black text-primary mt-0.5">${Number(product.price).toFixed(2)}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{product.views_count ?? 0}</span>
                        <span className="flex items-center gap-1"><Tag className="w-3 h-3" />{product.sales_count ?? 0} sold</span>
                        {product.avg_rating > 0 && <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-400" />{Number(product.avg_rating).toFixed(1)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex border-t border-border divide-x divide-border">
                    <button onClick={() => openEdit(product)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors">
                      <Edit className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button onClick={() => handleToggleActive(product.id, product.is_active)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors">
                      {product.is_active ? 'Hide' : 'Show'}
                    </button>
                    <button onClick={() => setQaProduct(product)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium hover:bg-blue-500/10 text-blue-500 transition-colors">
                      <HelpCircle className="w-3.5 h-3.5" /> Q&A
                    </button>
                    <button onClick={() => setBoostingProduct(product)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium hover:bg-amber-500/10 text-amber-600 transition-colors">
                      <Megaphone className="w-3.5 h-3.5" /> Boost
                    </button>
                    <button onClick={() => handleDelete(product.id)} className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/10 text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {qaProduct && <ProductQAModal product={qaProduct} onClose={() => setQaProduct(null)} />}
        {boostingProduct && <ProductBoostDialog product={boostingProduct} onClose={() => setBoostingProduct(null)} />}
      </div>
    );
  }

  // ── Marketplace ───────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto pb-20">
      <TopBar title="Marketplace" />

      <div className="sticky top-14 z-30 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm" />
          </div>
          <button onClick={() => setGridMode(g => g === 'grid' ? 'list' : 'grid')} className="p-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-muted-foreground">
            {gridMode === 'grid' ? <LayoutList className="w-4 h-4" /> : <Grid3x3 className="w-4 h-4" />}
          </button>
          {user && (
            <button onClick={() => setViewMode('my-products')} className="p-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-muted-foreground relative">
              <Package className="w-4 h-4" />
              {myProducts.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-primary-foreground text-[9px] font-bold rounded-full flex items-center justify-center">{myProducts.length}</span>}
            </button>
          )}
        </div>
      </div>

      {/* AdSense banner — marketplace page */}
      <ProductsAdBannerComponent />

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : (
        <>
          {!search && featuredProducts.length > 0 && (
            <div className="px-4 pt-4 pb-2">
              <div className="flex items-center gap-2 mb-3"><Sparkles className="w-4 h-4 text-primary" /><h2 className="font-bold text-base">Featured</h2></div>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                {featuredProducts.map(p => (
                  <a key={p.id} href={p.external_link ?? '#'} target={p.external_link ? '_blank' : '_self'} rel="noopener noreferrer" onClick={() => trackView(p.id)}
                    className="shrink-0 w-48 rounded-2xl overflow-hidden border border-border bg-card hover:shadow-lg transition-shadow group">
                    <div className="w-full h-32 bg-muted relative overflow-hidden">
                      {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        : <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-10 h-10 text-muted-foreground" /></div>}
                      <div className="absolute top-2 left-2"><span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-400/90 text-yellow-900"><Star className="w-2.5 h-2.5" /> Featured</span></div>
                    </div>
                    <div className="p-3">
                      <p className="font-semibold text-sm truncate">{p.name}</p>
                      <p className="text-base font-black text-primary mt-0.5">${Number(p.price).toFixed(2)}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {!search && (
            <div className="flex gap-4 px-4 py-3 border-y border-border bg-muted/20">
              <div className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-green-500" /><span className="text-sm font-semibold">{allProducts.length} products</span></div>
            </div>
          )}

          {user && !search && (
            <div className="mx-4 mt-4 p-4 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0"><Tag className="w-5 h-5 text-primary" /></div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">Sell your products</p>
                <p className="text-xs text-muted-foreground">List items and tag them in posts</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => navigate(`/seller/${user.username}`)}
                  className="flex items-center gap-1 px-3 py-2 border border-border text-primary rounded-full text-xs font-bold hover:bg-muted transition-colors">
                  <Store className="w-3.5 h-3.5" /> Store
                </button>
                <button onClick={() => { resetForm(); setViewMode('add-product'); }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-bold hover:opacity-90 transition-opacity">
                  <Plus className="w-3.5 h-3.5" /> Sell
                </button>
              </div>
            </div>
          )}

          <div className="p-4">
            {search && <p className="text-sm text-muted-foreground mb-3">{filteredProducts.length} result{filteredProducts.length !== 1 ? 's' : ''} for "{search}"</p>}
            {filteredProducts.length === 0 ? (
              <div className="text-center py-16">
                <ShoppingBag className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-30" />
                <h2 className="text-xl font-semibold mb-2">No products found</h2>
                <p className="text-muted-foreground text-sm">{search ? `No results for "${search}"` : 'Be the first to list a product!'}</p>
                {search && <button onClick={() => setSearch('')} className="mt-3 text-primary hover:underline text-sm">Clear search</button>}
              </div>
            ) : gridMode === 'grid' ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map(product => (
                  <ProductCard key={product.id} product={product}
                    wishlisted={wishlistArr.includes(product.id)}
                    onWishlist={() => toggleWishlist(product.id)}
                    onView={() => trackView(product.id)}
                    onProfile={() => navigate(`/profile/${product.user_profiles?.username}`)}
                    onReviews={() => setReviewProduct(product)}
                    onQA={() => setQaProduct(product)}
                    onTip={() => product.user_profiles && setTipSeller(product.user_profiles)}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredProducts.map(product => (
                  <ProductListItem key={product.id} product={product}
                    wishlisted={wishlistArr.includes(product.id)}
                    onWishlist={() => toggleWishlist(product.id)}
                    onView={() => trackView(product.id)}
                    onProfile={() => navigate(`/profile/${product.user_profiles?.username}`)}
                    onReviews={() => setReviewProduct(product)}
                    onQA={() => setQaProduct(product)}
                    onTip={() => product.user_profiles && setTipSeller(product.user_profiles)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {reviewProduct && <ProductReviewsModal product={reviewProduct} onClose={() => setReviewProduct(null)} />}
      {qaProduct && <ProductQAModal product={qaProduct} onClose={() => setQaProduct(null)} />}
      {tipSeller && <TipProductModal seller={tipSeller} onClose={() => setTipSeller(null)} />}
      {boostingProduct && <ProductBoostDialog product={boostingProduct} onClose={() => setBoostingProduct(null)} />}
    </div>
  );
}

// ── Product Card (Grid) ───────────────────────────────────────────────────────
function ProductCard({ product, wishlisted, onWishlist, onView, onProfile, onReviews, onQA, onTip }: {
  product: any; wishlisted: boolean; onWishlist: () => void;
  onView: () => void; onProfile: () => void; onReviews: () => void; onQA: () => void; onTip: () => void;
}) {
  return (
    <div className="rounded-2xl overflow-hidden border border-border bg-card hover:shadow-lg transition-all group">
      <div className="relative w-full aspect-square bg-muted overflow-hidden">
        {product.image_url
          ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-10 h-10 text-muted-foreground" /></div>}
        <button onClick={e => { e.preventDefault(); onWishlist(); }}
          className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all ${wishlisted ? 'bg-red-500 text-white' : 'bg-black/40 text-white hover:bg-red-500'}`}>
          <Heart className={`w-3.5 h-3.5 ${wishlisted ? 'fill-white' : ''}`} />
        </button>
        {product.stock === 0 && product.stock !== null && (
          <div className="absolute bottom-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/60 text-white">Sold out</div>
        )}
      </div>
      <div className="p-3">
        <p className="font-semibold text-sm leading-tight line-clamp-2 mb-1">{product.name}</p>
        <p className="text-base font-black text-primary">${Number(product.price).toFixed(2)}</p>
        {product.review_count > 0 && (
          <div className="flex items-center gap-1 mt-0.5">
            <StarRating rating={Math.round(product.avg_rating ?? 0)} />
            <span className="text-[10px] text-muted-foreground">({product.review_count})</span>
          </div>
        )}
        <button onClick={onProfile} className="flex items-center gap-1.5 mt-2 hover:opacity-80 transition-opacity">
          {product.user_profiles?.avatar_url ? <img src={product.user_profiles.avatar_url} alt="" className="w-5 h-5 rounded-full" /> : <div className="w-5 h-5 rounded-full bg-muted" />}
          <span className="text-[11px] text-muted-foreground truncate max-w-[80px]">{product.user_profiles?.username}</span>
          {product.user_profiles?.verified && <BadgeCheck className="w-3 h-3 text-primary flex-shrink-0" />}
        </button>
        <div className="mt-2 flex gap-1">
          {product.external_link ? (
            <a href={product.external_link} target="_blank" rel="noopener noreferrer" onClick={onView}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold rounded-lg transition-colors">
              Buy <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <button onClick={onReviews} className="flex-1 flex items-center justify-center gap-1 py-1.5 hover:bg-muted/50 text-muted-foreground text-xs rounded-lg transition-colors">
              <MessageSquare className="w-3 h-3" />{product.review_count > 0 ? product.review_count : '★'}
            </button>
          )}
          <button onClick={onQA} title="Q&A" className="flex items-center justify-center w-8 py-1.5 hover:bg-blue-500/10 text-blue-500 rounded-lg transition-colors">
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
          <button onClick={onTip} title="Tip seller" className="flex items-center justify-center w-8 py-1.5 hover:bg-yellow-500/10 text-yellow-600 rounded-lg transition-colors">
            <DollarSign className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AdSense banner — mounted once, push-guarded ─────────────────────────────────────────────────
// ad banner — defined above
function ProductsAdBannerComponent() { return <PageAdBanner />; }

// ── Product List Item ─────────────────────────────────────────────────────────
function ProductListItem({ product, wishlisted, onWishlist, onView, onProfile, onReviews, onQA, onTip }: {
  product: any; wishlisted: boolean; onWishlist: () => void;
  onView: () => void; onProfile: () => void; onReviews: () => void; onQA: () => void; onTip: () => void;
}) {
  return (
    <div className="flex gap-3 p-3 rounded-2xl border border-border bg-card hover:shadow-md transition-shadow">
      <div className="w-20 h-20 rounded-xl bg-muted overflow-hidden flex-shrink-0">
        {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-8 h-8 text-muted-foreground" /></div>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="font-bold text-base leading-tight line-clamp-1">{product.name}</p>
          <button onClick={e => { e.preventDefault(); onWishlist(); }}
            className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all border ${wishlisted ? 'bg-red-500/10 border-red-500/30 text-red-500' : 'border-border text-muted-foreground hover:text-red-500'}`}>
            <Heart className={`w-3.5 h-3.5 ${wishlisted ? 'fill-red-500' : ''}`} />
          </button>
        </div>
        {product.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{product.description}</p>}
        <p className="text-lg font-black text-primary mt-1">${Number(product.price).toFixed(2)}</p>
        {product.review_count > 0 && (
          <div className="flex items-center gap-1 mt-0.5">
            <StarRating rating={Math.round(product.avg_rating ?? 0)} />
            <span className="text-[10px] text-muted-foreground">({product.review_count})</span>
          </div>
        )}
        <div className="flex items-center justify-between mt-1.5">
          <button onClick={onProfile} className="flex items-center gap-1.5 hover:opacity-80">
            {product.user_profiles?.avatar_url ? <img src={product.user_profiles.avatar_url} alt="" className="w-4 h-4 rounded-full" /> : <div className="w-4 h-4 rounded-full bg-muted" />}
            <span className="text-[11px] text-muted-foreground">{product.user_profiles?.username}</span>
          </button>
          <div className="flex items-center gap-1">
            {product.external_link ? (
              <a href={product.external_link} target="_blank" rel="noopener noreferrer" onClick={onView}
                className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-bold rounded-full hover:opacity-90 transition-opacity">
                Buy <ChevronRight className="w-3 h-3" />
              </a>
            ) : (
              <button onClick={onReviews} className="flex items-center gap-1 px-2.5 py-1.5 border border-border text-xs text-muted-foreground rounded-full hover:bg-muted/50 transition-colors">
                <MessageSquare className="w-3 h-3" />{product.review_count > 0 ? product.review_count : '★'}
              </button>
            )}
            <button onClick={onQA} title="Q&A" className="p-1.5 rounded-full border border-border hover:bg-blue-500/10 hover:border-blue-500/30 text-blue-500 transition-colors">
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
            <button onClick={onTip} title="Tip" className="p-1.5 rounded-full border border-border hover:bg-yellow-500/10 hover:border-yellow-500/30 text-yellow-600 transition-colors">
              <DollarSign className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
