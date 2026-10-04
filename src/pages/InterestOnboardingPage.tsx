import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Check, Loader2, Sparkles, ArrowRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { PageAdBanner } from '@/components/features/AdSenseAd';
function InterestsAdBanner() { return <PageAdBanner />; }

interface InterestCategory {
  label: string;
  emoji: string;
  color: string;
  tags: { tag: string; emoji: string }[];
}

const INTEREST_CATEGORIES: InterestCategory[] = [
  {
    label: 'Tech & Science',
    emoji: '💻',
    color: 'from-blue-500/20 to-cyan-500/10 border-blue-500/20',
    tags: [
      { tag: 'technology', emoji: '🖥️' },
      { tag: 'ai', emoji: '🤖' },
      { tag: 'programming', emoji: '👨‍💻' },
      { tag: 'science', emoji: '🔬' },
      { tag: 'space', emoji: '🚀' },
      { tag: 'physics', emoji: '⚛️' },
      { tag: 'crypto', emoji: '₿' },
      { tag: 'web3', emoji: '🌐' },
    ],
  },
  {
    label: 'Arts & Culture',
    emoji: '🎨',
    color: 'from-purple-500/20 to-pink-500/10 border-purple-500/20',
    tags: [
      { tag: 'art', emoji: '🎨' },
      { tag: 'music', emoji: '🎵' },
      { tag: 'photography', emoji: '📸' },
      { tag: 'film', emoji: '🎬' },
      { tag: 'design', emoji: '✏️' },
      { tag: 'fashion', emoji: '👗' },
      { tag: 'books', emoji: '📚' },
      { tag: 'poetry', emoji: '📝' },
    ],
  },
  {
    label: 'Sports & Fitness',
    emoji: '⚽',
    color: 'from-green-500/20 to-emerald-500/10 border-green-500/20',
    tags: [
      { tag: 'football', emoji: '⚽' },
      { tag: 'basketball', emoji: '🏀' },
      { tag: 'fitness', emoji: '💪' },
      { tag: 'running', emoji: '🏃' },
      { tag: 'cycling', emoji: '🚴' },
      { tag: 'tennis', emoji: '🎾' },
      { tag: 'gaming', emoji: '🎮' },
      { tag: 'esports', emoji: '🏆' },
    ],
  },
  {
    label: 'Lifestyle',
    emoji: '🌿',
    color: 'from-amber-500/20 to-orange-500/10 border-amber-500/20',
    tags: [
      { tag: 'food', emoji: '🍜' },
      { tag: 'travel', emoji: '✈️' },
      { tag: 'health', emoji: '🧘' },
      { tag: 'nature', emoji: '🌿' },
      { tag: 'cooking', emoji: '👨‍🍳' },
      { tag: 'pets', emoji: '🐾' },
      { tag: 'mindfulness', emoji: '🧠' },
      { tag: 'sustainability', emoji: '♻️' },
    ],
  },
  {
    label: 'Business & Finance',
    emoji: '💼',
    color: 'from-slate-500/20 to-gray-500/10 border-slate-500/20',
    tags: [
      { tag: 'startup', emoji: '🚀' },
      { tag: 'investing', emoji: '📈' },
      { tag: 'entrepreneur', emoji: '💡' },
      { tag: 'marketing', emoji: '📣' },
      { tag: 'finance', emoji: '💰' },
      { tag: 'productivity', emoji: '⚡' },
      { tag: 'leadership', emoji: '🦁' },
      { tag: 'career', emoji: '👔' },
    ],
  },
  {
    label: 'News & Politics',
    emoji: '📰',
    color: 'from-red-500/20 to-rose-500/10 border-red-500/20',
    tags: [
      { tag: 'news', emoji: '📰' },
      { tag: 'politics', emoji: '🏛️' },
      { tag: 'worldnews', emoji: '🌍' },
      { tag: 'climate', emoji: '🌡️' },
      { tag: 'economics', emoji: '📊' },
      { tag: 'humanrights', emoji: '✊' },
      { tag: 'education', emoji: '🎓' },
      { tag: 'community', emoji: '🤝' },
    ],
  },
];

const MIN_SELECTIONS = 3;

export default function InterestOnboardingPage() {
  const { user } = useAuth();
  useSEO({ noindex: true, title: 'Choose Your Interests', url: '/interests' });
  const navigate = useNavigate();
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);

  // Load existing interests
  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    (async () => {
      const { data } = await supabase
        .from('user_interests')
        .select('hashtags(tag)')
        .eq('user_id', user.id);
      if (data && data.length > 0) {
        const tags = (data as any[]).map(i => i.hashtags?.tag).filter(Boolean);
        setSelectedTags(new Set(tags));
      }
      setLoadingExisting(false);
    })();
  }, [user?.id]);

  const toggle = (tag: string) => {
    setSelectedTags(prev => {
      const n = new Set(prev);
      if (n.has(tag)) n.delete(tag); else n.add(tag);
      return n;
    });
  };

  const selectAll = (category: InterestCategory) => {
    setSelectedTags(prev => {
      const n = new Set(prev);
      const allSelected = category.tags.every(t => n.has(t.tag));
      if (allSelected) {
        category.tags.forEach(t => n.delete(t.tag));
      } else {
        category.tags.forEach(t => n.add(t.tag));
      }
      return n;
    });
  };

  const handleSave = async () => {
    if (!user) return;
    if (selectedTags.size < MIN_SELECTIONS) {
      toast.error(`Select at least ${MIN_SELECTIONS} topics to personalize your feed`);
      return;
    }

    setSaving(true);
    try {
      const { data: savedCount, error } = await supabase.rpc('save_user_interests', {
        p_tags: Array.from(selectedTags),
      });

      if (error) throw error;
      if (typeof savedCount !== 'number' || savedCount < MIN_SELECTIONS) {
        throw new Error('We could not save all of your selected topics. Please try again.');
      }

      toast.success(`Saved ${savedCount} interests! Your feed is now personalised 🎉`);
      navigate(-1);
    } catch (error) {
      console.error('[InterestOnboardingPage] Failed to save interests', error);
      toast.error(error instanceof Error ? error.message : 'Could not save your interests. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const progressPct = Math.min((selectedTags.size / MIN_SELECTIONS) * 100, 100);
  const isComplete = selectedTags.size >= MIN_SELECTIONS;

  if (loadingExisting) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <TopBar title="Your Interests" showBack />
      <InterestsAdBanner />

      {/* Hero */}
      <div className="px-4 py-5 border-b border-border bg-gradient-to-br from-primary/5 to-transparent">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-lg leading-tight">What are you into?</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pick topics you care about — your For You feed will reflect them instantly.
            </p>
          </div>
        </div>

        {/* Progress ring + count */}
        <div className="mt-4 flex items-center gap-3">
          <div className="relative w-12 h-12 flex-shrink-0">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
              <circle
                cx="22" cy="22" r="18" fill="none" strokeWidth="3"
                stroke="currentColor"
                className={`transition-all duration-500 ${isComplete ? 'text-green-500' : 'text-primary'}`}
                strokeDasharray={`${2 * Math.PI * 18}`}
                strokeDashoffset={`${2 * Math.PI * 18 * (1 - progressPct / 100)}`}
                strokeLinecap="round"
              />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center text-[11px] font-bold ${isComplete ? 'text-green-500' : 'text-primary'}`}>
              {isComplete ? <Check className="w-4 h-4" /> : selectedTags.size}
            </span>
          </div>
          <div>
            <p className={`text-sm font-bold ${isComplete ? 'text-green-600' : 'text-foreground'}`}>
              {isComplete
                ? `${selectedTags.size} topics selected ✓`
                : `${selectedTags.size} of ${MIN_SELECTIONS} minimum`}
            </p>
            <p className="text-xs text-muted-foreground">
              {isComplete ? 'Looking good! You can always add more.' : `Select ${MIN_SELECTIONS - selectedTags.size} more to continue`}
            </p>
          </div>
          {selectedTags.size > 0 && (
            <button
              onClick={() => setSelectedTags(new Set())}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Category sections */}
      <div className="px-4 pt-4 space-y-6">
        {INTEREST_CATEGORIES.map(cat => {
          const catSelected = cat.tags.filter(t => selectedTags.has(t.tag)).length;
          const allSelected = catSelected === cat.tags.length;
          return (
            <div key={cat.label}>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{cat.emoji}</span>
                  <h3 className="font-bold text-sm">{cat.label}</h3>
                  {catSelected > 0 && (
                    <span className="text-[10px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded-full">
                      {catSelected}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => selectAll(cat)}
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                    allSelected
                      ? 'bg-primary/10 border-primary/20 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/30 hover:text-primary'
                  }`}
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className={`rounded-2xl border bg-gradient-to-br ${cat.color} p-3`}>
                <div className="flex flex-wrap gap-2">
                  {cat.tags.map(({ tag, emoji }) => {
                    const sel = selectedTags.has(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => toggle(tag)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold transition-all active:scale-95 ${
                          sel
                            ? 'bg-primary border-primary text-primary-foreground shadow-sm'
                            : 'bg-background/70 border-border text-foreground hover:border-primary/40 hover:bg-primary/5'
                        }`}
                      >
                        <span className="text-base leading-none">{emoji}</span>
                        <span>#{tag}</span>
                        {sel && <Check className="w-3 h-3" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky CTA */}
      <div className="fixed bottom-16 left-0 right-0 px-4 pb-2 z-40 pointer-events-none">
        <div className="max-w-2xl mx-auto pointer-events-auto">
          <div className="bg-background/95 backdrop-blur-md border border-border rounded-2xl p-3 shadow-xl">
            <button
              onClick={handleSave}
              disabled={saving || !isComplete}
              className={`w-full py-3.5 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all ${
                isComplete
                  ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-md'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              }`}
            >
              {saving ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  {isComplete ? `Save ${selectedTags.size} interests` : `Select ${MIN_SELECTIONS - selectedTags.size} more`}
                  {isComplete && <ArrowRight className="w-4 h-4" />}
                </>
              )}
            </button>
            <p className="text-center text-xs text-muted-foreground mt-1.5">
              Your feed personalises in real-time based on your picks
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

