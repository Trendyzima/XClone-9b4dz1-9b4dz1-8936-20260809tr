import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { Crown, Check, Loader2, Zap, Shield, Star, BadgeCheck, X, Sparkles, Volume2, Video, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { usePremium } from '@/hooks/usePremium';
import { useSEO } from '@/hooks/useSEO';
import { formatDistanceToNow } from 'date-fns';
import { PageAdBanner } from '@/components/features/AdSenseAd';
function PremiumAdBanner() { return <PageAdBanner />; }

const PLANS = [
  {
    id: 'monthly',
    label: 'Monthly',
    price: 4.99,
    period: '/month',
    saving: null,
    color: 'from-blue-500 to-cyan-500',
    badge: null,
  },
  {
    id: 'annual',
    label: 'Annual',
    price: 39.99,
    period: '/year',
    saving: 'Save 33%',
    color: 'from-purple-500 to-pink-500',
    badge: 'BEST VALUE',
  },
] as const;

// Static date — must never use Date.now() at module scope (causes esbuild hash collisions)
const PREMIUM_VALID_UNTIL = '2027-12-31';

const PREMIUM_FEATURES = [
  { icon: Ban, label: 'Zero Ads', desc: 'No pre-roll, mid-roll, or feed ads — ever' },
  { icon: Crown, label: 'Premium Badge', desc: 'Gold crown badge on your profile' },
  { icon: Video, label: 'HD Video Uploads', desc: 'Upload videos up to 200MB in HD quality' },
  { icon: Sparkles, label: 'AI Tools Unlimited', desc: 'Unlimited AI caption, writer & summarizer' },
  { icon: Volume2, label: 'Podcast Studio Pro', desc: 'HQ audio spaces with guest co-hosting' },
  { icon: Zap, label: 'Priority Feed', desc: 'Your posts shown first in followers\' feeds' },
  { icon: BadgeCheck, label: 'Verified Support', desc: 'Priority customer support response' },
  { icon: Shield, label: 'Advanced Privacy', desc: 'Enhanced privacy & data controls' },
];

export default function PremiumPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isActive, plan, expiresAt, loading: premiumLoading, refresh } = usePremium();
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual');
  const [subscribing, setSubscribing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useSEO({
    title: 'Testagram Premium — Ad-Free, Exclusive Features',
    description: 'Upgrade to Testagram Premium for an ad-free experience, exclusive badges, priority support, and advanced creator tools. Monthly and annual plans available.',
    url: '/premium',
    type: 'website',
    keywords: 'premium subscription, ad-free, creator tools, testagram premium, monthly plan, annual plan',
    structuredData: [
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Testagram Premium',
        description: 'Ad-free social media experience with exclusive badges, priority support, and advanced creator tools.',
        brand: { '@type': 'Organization', name: 'Testagram' },
        offers: [
          {
            '@type': 'Offer',
            name: 'Monthly Plan',
            price: '4.99',
            priceCurrency: 'USD',
            priceValidUntil: PREMIUM_VALID_UNTIL,
            availability: 'https://schema.org/InStock',
            url: 'https://testagram.site/premium',
          },
          {
            '@type': 'Offer',
            name: 'Annual Plan',
            price: '39.99',
            priceCurrency: 'USD',
            priceValidUntil: PREMIUM_VALID_UNTIL,
            availability: 'https://schema.org/InStock',
            url: 'https://testagram.site/premium',
          },
        ],
      },
    ],
  });

  useEffect(() => {
    if (user) refresh();
  }, [user?.id]);

  const handleSubscribe = async () => {
    if (!user) { navigate('/auth'); return; }
    setSubscribing(true);
    try {
      const chosen = PLANS.find(p => p.id === selectedPlan)!;
      const expiresAt = new Date();
      if (selectedPlan === 'monthly') {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      } else {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      }

      // Upsert subscription (replace any existing)
      const { error } = await supabase
        .from('premium_subscriptions')
        .upsert({
          user_id: user.id,
          plan: selectedPlan,
          status: 'active',
          price: chosen.price,
          started_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
        }, { onConflict: 'user_id' });

      if (error) throw error;

      // Grant premium badge in profile
      await supabase.from('profiles').update({ creator_tier: 'premium' }).eq('id', user.id).catch(() => {});

      // Platform inbox welcome
      await supabase.from('platform_inbox').insert({
        user_id: user.id,
        subject: '🎉 Welcome to Premium! Ads are now off.',
        body: `Your ${selectedPlan} Premium subscription is active until ${expiresAt.toLocaleDateString()}. Enjoy zero ads, HD uploads, and all premium features.`,
        type: 'update',
        icon_emoji: '👑',
        cta_label: 'Explore Premium',
        cta_url: '/premium',
      }).catch(() => {});

      await refresh();
      toast.success(`Premium activated! Ads are now disabled.`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to activate premium');
    } finally {
      setSubscribing(false);
    }
  };

  const handleCancel = async () => {
    if (!user) return;
    setCancelling(true);
    try {
      await supabase
        .from('premium_subscriptions')
        .update({ status: 'cancelled' })
        .eq('user_id', user.id);

      await supabase.from('platform_inbox').insert({
        user_id: user.id,
        subject: '😔 Premium cancelled — ads will resume at expiry',
        body: `Your premium subscription has been cancelled. You'll keep all benefits until ${expiresAt?.toLocaleDateString()}. After that, ads will resume. You can re-subscribe anytime.`,
        type: 'update',
        icon_emoji: '📅',
        cta_label: 'Re-subscribe',
        cta_url: '/premium',
      }).catch(() => {});

      await refresh();
      toast.success('Subscription cancelled. Benefits continue until expiry.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel subscription');
    } finally {
      setCancelling(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Crown className="w-16 h-16 mx-auto mb-4 text-primary" />
          <h2 className="text-2xl font-bold mb-2">Go Premium</h2>
          <p className="text-muted-foreground mb-6">Sign in to subscribe</p>
          <Button onClick={() => navigate('/auth')} size="lg" className="rounded-full">Sign In</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Premium" showBack />
      <PremiumAdBanner />

      <div className="max-w-2xl mx-auto p-4 space-y-8">
        {/* Hero */}
        <div className="text-center pt-4">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full mb-4 shadow-xl shadow-amber-500/25">
            <Crown className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-black mb-2">Go Ad-Free</h1>
          <p className="text-muted-foreground">Premium removes all ads and unlocks exclusive features</p>
        </div>

        {/* Active subscription card */}
        {!premiumLoading && isActive && (
          <div className="rounded-2xl bg-gradient-to-br from-amber-400/10 to-orange-500/10 border-2 border-amber-400/30 p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                <Crown className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-bold">Premium Active ✅</p>
                <p className="text-sm text-muted-foreground capitalize">{plan} plan</p>
              </div>
              <span className="ml-auto text-xs bg-green-500/10 text-green-600 font-bold px-2.5 py-1 rounded-full border border-green-500/20">Ad-Free</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Expires {expiresAt ? formatDistanceToNow(expiresAt, { addSuffix: true }) : ''}
              </span>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex items-center gap-1.5 text-red-500 hover:text-red-600 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                Cancel subscription
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 border-t border-border pt-2">
              After cancelling, ads resume when your current period ends.
            </p>
          </div>
        )}

        {/* Features grid */}
        <div className="grid grid-cols-2 gap-3">
          {PREMIUM_FEATURES.map(f => {
            const Icon = f.icon;
            return (
              <div key={f.label} className="rounded-xl border border-border bg-card p-3.5 flex gap-3 items-start hover:border-primary/20 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{f.label}</p>
                  <p className="text-xs text-muted-foreground leading-snug mt-0.5">{f.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Plan selector — only show when not active */}
        {!isActive && (
          <div className="space-y-4">
            <h2 className="font-bold text-lg text-center">Choose Your Plan</h2>
            <div className="grid grid-cols-2 gap-3">
              {PLANS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPlan(p.id)}
                  className={`relative rounded-2xl border-2 p-4 text-left transition-all ${
                    selectedPlan === p.id
                      ? 'border-primary bg-primary/5 shadow-md shadow-primary/10'
                      : 'border-border hover:border-primary/30'
                  }`}
                >
                  {p.badge && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-black bg-gradient-to-r from-purple-500 to-pink-500 text-white px-2.5 py-0.5 rounded-full whitespace-nowrap">
                      {p.badge}
                    </span>
                  )}
                  <p className="font-bold text-sm">{p.label}</p>
                  <p className="text-2xl font-black mt-1">${p.price}</p>
                  <p className="text-xs text-muted-foreground">{p.period}</p>
                  {p.saving && (
                    <span className="mt-1.5 inline-block text-[10px] font-bold text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full">
                      {p.saving}
                    </span>
                  )}
                  {selectedPlan === p.id && (
                    <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>

            <Button
              onClick={handleSubscribe}
              disabled={subscribing}
              size="lg"
              className="w-full rounded-2xl h-14 text-base font-black bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-white shadow-lg shadow-amber-500/20 border-0"
            >
              {subscribing ? (
                <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Activating…</>
              ) : (
                <><Crown className="w-5 h-5 mr-2" /> Start Premium — ${PLANS.find(p => p.id === selectedPlan)?.price}/{selectedPlan === 'monthly' ? 'mo' : 'yr'}</>
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Cancel anytime. Ads resume after your billing period ends.
            </p>
          </div>
        )}

        {/* Re-subscribe when cancelled */}
        {!premiumLoading && !isActive && (
          <div className="rounded-xl bg-muted/30 border border-border p-4 flex items-start gap-3">
            <Star className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold">Why go Premium?</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ads are completely removed the moment you subscribe — no waiting, no setup. If you cancel, ads automatically resume when your period expires.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
