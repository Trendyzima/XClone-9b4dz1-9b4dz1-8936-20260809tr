import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Coins, Loader2, Sparkles } from 'lucide-react';

type TargetType = 'post' | 'profile';

export function CreditBoostDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: TargetType;
  targetId: string;
  title?: string;
}) {
  const [credits, setCredits] = useState(0);
  const [balance, setBalance] = useState(0);
  const [duration, setDuration] = useState(72);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const durationOptions = useMemo(() => [24, 72, 168], []);\n  const dailyBase = targetType === 'profile' ? 250 : 100;\n  const computedCost = Math.round(dailyBase * duration / 24);
  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('user_wallets').select('credits').maybeSingle();
    setLoading(false);
    if (!error) setBalance(Number(data?.credits ?? 0));
  };

  useEffect(() => { if (open) void load(); }, [open]);

  const launch = async () => {
    const spend = computedCost;\n    if (spend > balance) {
      toast.error('Not enough credits. Earn more from Daily Rewards or Rewarded Ads.');
      return;
    }
    setBusy(true);
    const idempotencyKey = crypto.randomUUID() + ':' + Date.now();
    const { data, error } = await supabase.rpc('create_credit_boost', {
      p_target_type: targetType,
      p_target_id: targetId,
      p_credits: credits,
      p_duration_days: duration,
      p_target_audience: { mode: 'organic_discovery', target: targetType },
      p_idempotency_key: idempotencyKey,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message.replaceAll('_', ' '));
      return;
    }
    toast.success(`${targetType === 'profile' ? 'Profile' : 'Post'} boosted with ${credits} credits.`);
    setBalance(Math.max(0, balance - credits));
    onOpenChange(false);
    return data;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" />Boost with Credits</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <p className="text-sm font-semibold">{title || (targetType === 'profile' ? 'Boost your profile' : 'Boost your content')}</p>
            <p className="text-xs text-muted-foreground mt-1">Credits are an internal promotion balance. They do not withdraw as cash.</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2"><span className="text-sm font-semibold">Available credits</span><strong>{loading ? '…' : balance.toLocaleString()}</strong></div>
            <div className="grid grid-cols-3 gap-2">{durationOptions.map(v => <button key={v} onClick={() => setDuration(v)} className={`rounded-xl border p-2 text-sm font-bold ${duration === v ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>{v === 24 ? '1 day' : v === 72 ? '3 days' : '7 days'}</button>)}</div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2"><span className="text-sm font-semibold">Duration</span><strong>{duration / 24} days · {computedCost.toLocaleString()} credits</strong></div>
            <input className="w-full" type="range" min="24" max="168" step="24" value={duration} onChange={e => setDuration(Number(e.target.value))} />
          </div>
          <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            <Coins className="inline w-4 h-4 mr-1" /> This uses the existing server-authoritative credit boost ledger. Posts cost 100 credits/day; profiles cost 250 credits/day. Max 3 active boosts and 2,000 credits per 24 hours.
          </div>
          <Button onClick={launch} disabled={busy || loading || computedCost > balance} className="w-full">
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Launching…</> : `Use ${computedCost.toLocaleString()} credits`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
