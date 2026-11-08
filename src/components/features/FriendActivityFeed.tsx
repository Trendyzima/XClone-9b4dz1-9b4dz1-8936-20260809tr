import { useState, useEffect } from 'react';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { Loader2, Users, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

interface Props {
  userId: string;
}

export default function FriendActivityFeed({ userId }: Props) {
  const [feed,    setFeed]    = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const result = await backendCapabilities.call<{items:any[]}>('testagram.wallet.friends.activity',{limit:20});
      const inboxData = result.items ?? [];

      // Parse sender usernames from the subject line (format: "You received $X from @username")
      const parsed = (inboxData ?? []).map(m => {
        const isReceived = (m.subject as string).startsWith('You received');
        const isSent     = (m.subject as string).includes('Transfer of');
        const match      = isReceived
          ? (m.subject as string).match(/from @(\w+)/)
          : (m.subject as string).match(/to @(\w+)/);
        const partner = match ? match[1] : null;
        const amtMatch = (m.subject as string).match(/\$([\d.]+)/);
        const amount   = amtMatch ? parseFloat(amtMatch[1]) : 0;
        return { id: m.id, isReceived, isSent, partner, amount, at: m.sent_at };
      }).filter(x => x.partner && x.amount > 0);

      setFeed(parsed);
      setLoading(false);
    };
    load();
  }, [userId]);

  if (loading) {
    return (
      <div className="border border-border rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm">Recent Activity</h3>
        </div>
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      </div>
    );
  }

  if (feed.length === 0) return null;

  return (
    <div className="border border-border rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-sm">Recent Activity</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">{feed.length} recent</span>
      </div>
      <div className="space-y-2">
        {feed.map(item => (
          <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border/50">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${item.isReceived ? 'bg-green-500/10' : 'bg-orange-500/10'}`}>
              {item.isReceived
                ? <ArrowDownLeft className="w-3.5 h-3.5 text-green-600" />
                : <ArrowUpRight  className="w-3.5 h-3.5 text-orange-600" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold">
                {item.isReceived ? `Received from @${item.partner}` : `Sent to @${item.partner}`}
              </p>
              <p className="text-[10px] text-muted-foreground">{new Date(item.at).toLocaleString()}</p>
            </div>
            <p className={`text-sm font-black shrink-0 ${item.isReceived ? 'text-green-600' : 'text-orange-600'}`}>
              {item.isReceived ? '+' : '-'}${item.amount.toFixed(2)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
