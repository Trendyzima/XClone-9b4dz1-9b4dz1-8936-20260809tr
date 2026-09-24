import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

const INTEREST_CHIPS = [
  { tag: 'technology', emoji: '💻' }, { tag: 'ai', emoji: '🤖' },
  { tag: 'music', emoji: '🎵' }, { tag: 'art', emoji: '🎨' },
  { tag: 'football', emoji: '⚽' }, { tag: 'fitness', emoji: '💪' },
  { tag: 'food', emoji: '🍜' }, { tag: 'travel', emoji: '✈️' },
  { tag: 'finance', emoji: '💰' }, { tag: 'science', emoji: '🔬' },
  { tag: 'gaming', emoji: '🎮' }, { tag: 'news', emoji: '📰' },
];

export function InterestOnboardingSheet() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    const key = `ts-interest-onboarded-${user.id}`;
    if (localStorage.getItem(key)) return;
    const timer = setTimeout(() => setShow(true), 1800);
    return () => clearTimeout(timer);
  }, [user?.id]);

  const toggle = (tag: string) => setSelectedTags((previous) =>
    previous.includes(tag) ? previous.filter((item) => item !== tag) : [...previous, tag]
  );

  const dismiss = () => {
    if (user) localStorage.setItem(`ts-interest-onboarded-${user.id}`, '1');
    setShow(false);
  };

  const handleSave = async () => {
    if (!user || selectedTags.length < 3) return;
    setSaving(true);
    try {
      for (const tag of selectedTags) {
        let hashtagId: string | null = null;
        const { data: existing } = await supabase.from('hashtags').select('id').eq('tag', tag).maybeSingle();
        if (existing?.id) {
          hashtagId = existing.id;
        } else {
          const { data: created } = await supabase.from('hashtags').insert({ tag }).select('id').single();
          hashtagId = created?.id ?? null;
        }
        if (hashtagId) {
          await supabase.from('user_interests').upsert(
            { user_id: user.id, hashtag_id: hashtagId, interest_score: 1 },
            { onConflict: 'user_id,hashtag_id' }
          ).catch(() => undefined);
        }
      }
      localStorage.setItem(`ts-interest-onboarded-${user.id}`, '1');
      setShow(false);
    } finally {
      setSaving(false);
    }
  };

  if (!show || !user) return null;

  return (
    <div className="fixed inset-0 z-[600] flex items-end justify-center" onClick={dismiss}>
      <div className="w-full max-w-2xl bg-background rounded-t-3xl border-t border-border shadow-2xl p-5 pb-8 max-h-[80vh] overflow-y-auto animate-in slide-in-from-bottom duration-300" onClick={(event) => event.stopPropagation()}>
        <div className="flex justify-center mb-4"><div className="w-10 h-1.5 rounded-full bg-muted" /></div>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center"><Sparkles className="w-5 h-5 text-primary" /></div>
            <div><h2 className="font-bold text-lg">What are you into?</h2><p className="text-xs text-muted-foreground mt-0.5">Pick at least 3 topics to personalise your feed</p></div>
          </div>
          <button onClick={dismiss} className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex flex-wrap gap-2 mb-5">
          {INTEREST_CHIPS.map(({ tag, emoji }) => {
            const selected = selectedTags.includes(tag);
            return <button key={tag} onClick={() => toggle(tag)} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold transition-all active:scale-95 ${selected ? 'bg-primary border-primary text-primary-foreground shadow-sm' : 'bg-muted/30 border-border text-foreground hover:border-primary/40 hover:bg-primary/5'}`}>
              <span className="text-base leading-none">{emoji}</span><span>#{tag}</span>{selected && <Check className="w-3 h-3" />}
            </button>;
          })}
        </div>
        <div className="flex gap-3">
          <button onClick={() => { navigate('/interests'); dismiss(); }} className="flex-1 py-2.5 border border-border rounded-xl text-sm font-semibold hover:bg-muted">See all topics</button>
          <button onClick={handleSave} disabled={saving || selectedTags.length < 3} className={`flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 ${selectedTags.length >= 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4" />Save {selectedTags.length >= 3 ? `${selectedTags.length} interests` : `(${3 - selectedTags.length} more)`}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
