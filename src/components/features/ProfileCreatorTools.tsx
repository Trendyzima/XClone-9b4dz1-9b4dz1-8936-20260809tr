import { useEffect, useState } from 'react';
import { BarChart3, Megaphone, Wallet, ChevronRight, ShoppingBag, PackagePlus, Coins } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { CreditsBoostDialog } from './CreditsBoostDialog';

export function ProfileCreatorTools({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [balance, setBalance] = useState<number | null>(null);
  const [showCreditsBoost, setShowCreditsBoost] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.rpc('get_my_credit_balance').then(({ data }) => {
      if (active) setBalance(data == null ? null : Number(data));
    });
    return () => { active = false; };
  }, [userId]);

  return (
    <>
      <section className="my-3 rounded-2xl border border-border bg-card/60 overflow-hidden">
        <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-border">
          <div>
            <p className="text-sm font-bold">Creator tools</p>
            <p className="text-[11px] text-muted-foreground">Create, grow and manage your Testagram business</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-6 divide-x divide-border">
          <button onClick={() => navigate('/shop')} className="p-3 text-left hover:bg-muted/60 transition-colors group">
            <ShoppingBag className="w-4 h-4 mb-2 text-primary" />
            <span className="block text-xs font-semibold">Mall</span>
            <span className="text-[10px] text-muted-foreground">Shop products</span>
            <ChevronRight className="w-3.5 h-3.5 mt-1 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </button>
          <button onClick={() => navigate('/products')} className="p-3 text-left hover:bg-muted/60 transition-colors group">
            <PackagePlus className="w-4 h-4 mb-2 text-primary" />
            <span className="block text-xs font-semibold">Sell</span>
            <span className="text-[10px] text-muted-foreground">Post products</span>
            <ChevronRight className="w-3.5 h-3.5 mt-1 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </button>
          <button onClick={() => navigate('/creator-studio')} className="p-3 text-left hover:bg-muted/60 transition-colors group">
            <BarChart3 className="w-4 h-4 mb-2 text-primary" />
            <span className="block text-xs font-semibold">Studio</span>
            <span className="text-[10px] text-muted-foreground">Create &amp; insights</span>
            <ChevronRight className="w-3.5 h-3.5 mt-1 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </button>
          <button onClick={() => navigate('/create-ad')} className="p-3 text-left hover:bg-muted/60 transition-colors group">
            <Megaphone className="w-4 h-4 mb-2 text-primary" />
            <span className="block text-xs font-semibold">Ads</span>
            <span className="text-[10px] text-muted-foreground">Paid campaigns</span>
            <ChevronRight className="w-3.5 h-3.5 mt-1 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </button>
          <button onClick={() => setShowCreditsBoost(true)} className="p-3 text-left hover:bg-muted/60 transition-colors group">
            <Coins className="w-4 h-4 mb-2 text-primary" />
            <span className="block text-xs font-semibold">Boost</span>
            <span className="text-[10px] text-muted-foreground">{balance == null ? 'Use credits' : `${balance.toLocaleString()} credits`}</span>
            <ChevronRight className="w-3.5 h-3.5 mt-1 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </button>
          <button onClick={() => navigate('/wallet')} className="p-3 text-left hover:bg-muted/60 transition-colors group">
            <Wallet className="w-4 h-4 mb-2 text-primary" />
            <span className="block text-xs font-semibold">Wallet</span>
            <span className="text-[10px] text-muted-foreground">Money &amp; payouts</span>
            <ChevronRight className="w-3.5 h-3.5 mt-1 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </section>
      <CreditsBoostDialog
        sourceType="profile"
        sourceId={userId}
        open={showCreditsBoost}
        onOpenChange={setShowCreditsBoost}
        onSuccess={() => {
          supabase.rpc('get_my_credit_balance').then(({ data }) => setBalance(data == null ? null : Number(data)));
        }}
      />
    </>
  );
}
