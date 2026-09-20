import { useEffect, useState } from 'react';
import { BarChart3, Megaphone, Wallet, ChevronRight, ShoppingBag, PackagePlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export function ProfileCreatorTools({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    supabase.from('user_wallets').select('balance').eq('user_id', userId).maybeSingle().then(({ data }) => {
      if (active) setBalance(data?.balance == null ? null : Number(data.balance));
    });
    return () => { active = false; };
  }, [userId]);

  return (
    <section className="my-3 rounded-2xl border border-border bg-card/60 overflow-hidden">
      <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-border">
        <div>
          <p className="text-sm font-bold">Creator tools</p>
          <p className="text-[11px] text-muted-foreground">Create, grow and manage your Testagram business</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-border">
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
          <span className="text-[10px] text-muted-foreground">Promote content</span>
          <ChevronRight className="w-3.5 h-3.5 mt-1 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
        </button>
        <button onClick={() => navigate('/wallet')} className="p-3 text-left hover:bg-muted/60 transition-colors group">
          <Wallet className="w-4 h-4 mb-2 text-primary" />
          <span className="block text-xs font-semibold">Wallet</span>
          <span className="text-[10px] text-muted-foreground">{balance == null ? 'Manage balance' : `$${balance.toFixed(2)} available`}</span>
          <ChevronRight className="w-3.5 h-3.5 mt-1 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>
    </section>
  );
}
