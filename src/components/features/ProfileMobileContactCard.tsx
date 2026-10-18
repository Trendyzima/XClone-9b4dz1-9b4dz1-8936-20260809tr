import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, Pencil, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export function ProfileMobileContactCard({ username }: { username: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    let cancelled = false;
    void supabase.from('profile_contact_methods').select('phone_e164')
      .eq('user_id', user.id).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.warn('[profile] private mobile contact lookup failed:', error.message);
        setPhone(data?.phone_e164 ?? null);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  if (!user) return null;
  return (
    <section className="mx-4 mt-4 rounded-2xl border border-border bg-card p-4" aria-label="Private mobile contact">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Phone className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">Private mobile contact</h2>
          <p className="mt-1 text-xs text-muted-foreground">Used for communication features. This number is visible only to you here and is not published on your profile.</p>
          <div className="mt-2 text-sm font-medium">
            {loading ? <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking saved number…</span> : phone ?? <span className="text-muted-foreground">No mobile number saved yet</span>}
          </div>
        </div>
        <button type="button" onClick={() => navigate('/profile/complete?returnTo=' + encodeURIComponent('/profile/' + username))} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-muted" aria-label={phone ? 'Edit mobile number' : 'Add mobile number'}>
          <Pencil className="h-3.5 w-3.5" />{phone ? 'Edit' : 'Add'}
        </button>
      </div>
    </section>
  );
}
