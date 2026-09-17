import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { TrendingUp, Target, Calendar, DollarSign, Loader2 } from 'lucide-react';
import { PaymentDialog } from './PaymentDialog';
import { useToast } from '@/hooks/use-toast';

interface BoostPostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: string;
}

export function BoostPostDialog({ open, onOpenChange, postId }: BoostPostDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [budget, setBudget] = useState(10);
  const [duration, setDuration] = useState(7);
  const [showPayment, setShowPayment] = useState(false);
  const [creating, setCreating] = useState(false);
  const [promotionId, setPromotionId] = useState<string | null>(null);
  const [targetAudience] = useState({ age_min: 18, age_max: 65, interests: [] as string[] });

  const estimatedReach = Math.floor(budget * 100 * duration);

  const handleBoost = async () => {
    if (!user) { toast({ title: 'Sign in required', description: 'Please sign in to promote a post', variant: 'destructive' }); return; }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('testagram-ads', {
        body: { source_type: 'post', source_id: postId, goal: 'post_engagement', budget_minor: Math.round(budget * 100), duration_days: duration },
      });
      if (error) throw error;
      const id = data?.promotion_id;
      if (!id) throw new Error('Testagram did not return a promotion id');
      setPromotionId(id);
      setShowPayment(true);
    } catch (error: any) {
      console.error('Testagram boost creation error:', error);
      toast({ title: 'Could not start promotion', description: error.message || 'Please try again', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handlePaymentSuccess = () => {
    toast({
      title: 'Promotion payment confirmed',
      description: promotionId ? `Promotion ${promotionId.slice(0, 8)} is now queued for Testagram ad review and delivery.` : 'Your promotion is queued for Testagram ad review and delivery.',
    });
    setShowPayment(false);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              Boost Your Post
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2"><DollarSign className="w-4 h-4" />Daily Budget</Label>
                <span className="text-2xl font-bold">${budget}</span>
              </div>
              <Slider value={[budget]} onValueChange={(value) => setBudget(value[0])} min={5} max={100} step={5} className="w-full" />
              <p className="text-sm text-muted-foreground">Spend ${budget} per day to reach more people.</p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2"><Calendar className="w-4 h-4" />Duration</Label>
                <span className="text-2xl font-bold">{duration} days</span>
              </div>
              <Slider value={[duration]} onValueChange={(value) => setDuration(value[0])} min={1} max={30} step={1} className="w-full" />
              <p className="text-sm text-muted-foreground">Run your campaign for {duration} day{duration !== 1 ? 's' : ''}.</p>
            </div>

            <div className="bg-primary/10 p-4 rounded-lg">
              <div className="flex items-center gap-3 mb-2"><Target className="w-5 h-5 text-primary" /><h3 className="font-semibold">Estimated Reach</h3></div>
              <p className="text-3xl font-bold mb-1">{estimatedReach.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">Estimated additional people reached; actual delivery depends on auction, targeting and available inventory.</p>
            </div>

            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-4"><span className="font-semibold">Total Budget</span><span className="text-2xl font-bold">${(budget * duration).toFixed(2)}</span></div>
              <Button onClick={handleBoost} disabled={creating} className="w-full" size="lg">
                {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {creating ? 'Preparing promotion…' : 'Continue to Payment'}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">Testagram owns the promotion, billing and delivery contract. ZenAd is not exposed to the browser.</p>
          </div>
        </DialogContent>
      </Dialog>

      <PaymentDialog
        open={showPayment}
        onOpenChange={setShowPayment}
        amount={budget * duration}
        type="boost_post"
        metadata={{ promotion_id: promotionId, post_id: postId, budget, duration, target_audience: targetAudience, ad_platform: 'testagram' }}
        onSuccess={handlePaymentSuccess}
      />
    </>
  );
}
