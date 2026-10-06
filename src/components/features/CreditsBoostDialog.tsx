import { useEffect, useMemo, useState } from 'react';
import { Coins, Loader2, Sparkles, Clock3, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

type SourceType = 'post' | 'profile';

interface CreditsBoostDialogProps {
  sourceType: SourceType;
  sourceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const PLANS: Record<SourceType, Array<{hours:number; credits:number; label:string; note:string}>> = {
  post: [
    { hours: 24, credits: 100, label: '1 day', note: 'Light discovery push' },
    { hours: 72, credits: 300, label: '3 days', note: 'Sustained reach' },
    { hours: 168, credits: 700, label: '7 days', note: 'Maximum duration' },
  ],
  profile: [
    { hours: 24, credits: 250, label: '1 day', note: 'Profile discovery' },
    { hours: 72, credits: 750, label: '3 days', note: 'Sustained discovery' },
    { hours: 168, credits: 1750, label: '7 days', note: 'Maximum duration' },
  ],
};

export function CreditsBoostDialog({
  sourceType,
  sourceId,
  open,
  onOpenChange,
  onSuccess,
}: CreditsBoostDialogProps) {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [hours, setHours] = useState(PLANS[sourceType][0].hours);
  const [loading, setLoading] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);

  const plan = useMemo(
    () => PLANS[sourceType].find((item) => item.hours === hours) ?? PLANS[sourceType][0],
    [hours, sourceType],
  );

  const refreshBalance = async () => {
    if (!user) return;
    setLoadingBalance(true);
    try {
      const { data, error } = await supabase.rpc('get_my_credit_balance');
      if (error) throw error;
      setBalance(Number(data ?? 0));
    } catch (error) {
      console.error('[credits-boost] balance', error);
      setBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  };

  useEffect(() => {
    if (open) void refreshBalance();
  }, [open, user?.id]);

  const submit = async () => {
    if (!user) {
      toast.error('Sign in to use credits');
      return;
    }
    if ((balance ?? 0) < plan.credits) {
      toast.error('Not enough credits for this boost');
      return;
    }

    setLoading(true);
    try {
      const idempotencyKey = `credit-boost:${user.id}:${sourceType}:${sourceId}:${hours}:${crypto.randomUUID()}`;
      const { data, error } = await supabase.rpc('create_credit_boost', {
        p_source_type: sourceType,
        p_source_id: sourceId,
        p_duration_hours: hours,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;

      toast.success(
        sourceType === 'profile'
          ? 'Profile boost activated'
          : 'Post boost activated',
        {
          description: `${Number(data?.credits_spent ?? plan.credits).toLocaleString()} credits spent · ${plan.label}`,
        },
      );
      await refreshBalance();
      onSuccess?.();
      onOpenChange(false);
    } catch (error: any) {
      const message = String(error?.message ?? 'Unable to activate credits boost');
      const friendly =
        message.includes('INSUFFICIENT_CREDITS') ? 'You do not have enough credits.' :
        message.includes('ACTIVE_BOOST_LIMIT') ? 'You already have the maximum number of active boosts.' :
        message.includes('SOURCE_ALREADY_BOOSTED') ? 'This item already has an active boost.' :
        message.includes('CREDIT_BOOST_DAILY_LIMIT') ? 'Your 24-hour credits boost limit has been reached.' :
        message;
      toast.error(friendly);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Coins className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-lg">Boost with Credits</h2>
            <p className="text-sm text-muted-foreground">
              {sourceType === 'profile'
                ? 'Give your profile more organic discovery.'
                : 'Give this post more organic discovery.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="rounded-xl border border-border bg-muted/30 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Available credits</span>
            </div>
            <span className="font-black">{loadingBalance ? '…' : (balance ?? 0).toLocaleString()}</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {PLANS[sourceType].map((item) => (
              <button
                key={item.hours}
                type="button"
                onClick={() => setHours(item.hours)}
                className={`rounded-xl border-2 p-3 text-left transition-colors ${
                  item.hours === hours ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                }`}
              >
                <Clock3 className="w-4 h-4 mb-2 text-primary" />
                <div className="font-bold text-sm">{item.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{item.credits.toLocaleString()} credits</div>
              </button>
            ))}
          </div>

          <div className="rounded-xl bg-primary/5 border border-primary/15 p-4">
            <div className="flex items-center gap-2 font-semibold">
              <Sparkles className="w-4 h-4 text-primary" />
              Organic distribution
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              The boost is a ranking signal, not a separate ad format. It is mixed into discovery and remains clearly labeled as boosted.
            </p>
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-green-600" />
            <span>Credits are debited atomically on the server. Browser clients cannot mint, edit, or refund credit ledger entries.</span>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={submit} disabled={loading || loadingBalance || (balance ?? 0) < plan.credits}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Coins className="w-4 h-4 mr-2" />}
              Boost · {plan.credits.toLocaleString()}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
