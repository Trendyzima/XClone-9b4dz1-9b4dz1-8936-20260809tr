import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Loader2, Bell, X, Calendar, Send, CheckCircle2 } from 'lucide-react';

type CurrencyCode = 'USD' | 'KES' | 'EUR';
const CURRENCIES_LOCAL = [
  { code: 'USD' as CurrencyCode, symbol: '$',    rate: 1    },
  { code: 'KES' as CurrencyCode, symbol: 'KES ', rate: 130  },
  { code: 'EUR' as CurrencyCode, symbol: '€',    rate: 0.92 },
];
function fmtAmt(usd: number, cur: CurrencyCode): string {
  const c = CURRENCIES_LOCAL.find(x => x.code === cur) ?? CURRENCIES_LOCAL[0];
  const v = usd * c.rate;
  return cur === 'KES' ? `KES ${Math.round(v).toLocaleString()}` : `${c.symbol}${v.toFixed(2)}`;
}

const FREQ_LABELS: Record<string, string> = { once: 'Once', weekly: 'Weekly', monthly: 'Monthly' };
const FREQ_OPTIONS = ['once', 'weekly', 'monthly'] as const;

interface Props {
  userId: string;
  currency: CurrencyCode;
}

export default function TransactionRemindersTab({ userId, currency }: Props) {
  const [reminders,   setReminders]   = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [label,       setLabel]       = useState('');
  const [amount,      setAmount]      = useState('');
  const [toUsername,  setToUsername]  = useState('');
  const [frequency,   setFrequency]   = useState<'once' | 'weekly' | 'monthly'>('once');
  const [remindAt,    setRemindAt]    = useState('');
  const [saving,      setSaving]      = useState(false);
  const [dispatching, setDispatching] = useState<string | null>(null);

  const minDateTime = useMemo(() => {
    const d = new Date(Date.now() + 60000);
    return d.toISOString().slice(0, 16);
  }, []);

  useEffect(() => { loadReminders(); }, [userId]);

  const loadReminders = async () => {
    setLoading(true);
    const { data } = await supabase.from('wallet_transaction_reminders').select('*')
      .eq('user_id', userId).eq('is_active', true).order('remind_at', { ascending: true });
    setReminders(data ?? []);
    setLoading(false);
  };

  const createReminder = async () => {
    if (!label.trim() || !remindAt) { toast.error('Enter a label and reminder time'); return; }
    const scheduledDate = new Date(remindAt);
    if (scheduledDate.getTime() <= Date.now()) { toast.error('Must be a future date/time'); return; }
    setSaving(true);
    const { data: walletRow } = await supabase.from('wallets').select('id').eq('user_id', userId).single();
    if (!walletRow?.id) { setSaving(false); toast.error('Wallet not provisioned'); return; }
    const { error } = await supabase.from('wallet_transaction_reminders').insert({
      user_id: userId, wallet_id: walletRow?.id, title: label.trim(), amount: amount ? parseFloat(amount) : null,
      to_username: toUsername.trim() || null, frequency, currency: 'USD', remind_at: scheduledDate.toISOString(),
    });
    setSaving(false);
    if (error) { toast.error('Failed to create reminder'); return; }
    toast.success('Reminder set!');
    setShowForm(false); setLabel(''); setAmount(''); setToUsername(''); setFrequency('once'); setRemindAt('');
    loadReminders();
  };

  const dispatchNow = async (r: any) => {
    setDispatching(r.id);
    const amtStr = r.amount ? fmtAmt(Number(r.amount), currency) : '';
    await supabase.from('platform_inbox').insert({
      user_id: userId,
      subject: `🔔 Reminder: ${r.title}`,
      body: `${r.label}${amtStr ? ` — ${amtStr}` : ''}${r.to_username ? ` to @${r.to_username}` : ''}.`,
      type: 'news', icon_emoji: '🔔',
      cta_label: r.to_username ? 'Send Now' : 'View Wallet',
      cta_url: r.to_username ? `/wallet?tab=send&to=${r.to_username}` : '/wallet',
    });
    await supabase.from('wallet_transaction_reminders').update({ last_sent_at: new Date().toISOString() }).eq('id', r.id);
    setDispatching(null);
    toast.success('Reminder sent to inbox!');
    loadReminders();
  };

  const deleteReminder = async (id: string) => {
    const { error } = await supabase.from('wallet_transaction_reminders').update({ is_active: false }).eq('id', id);
    if (error) { toast.error('Failed to remove'); return; }
    toast.success('Reminder removed');
    loadReminders();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm">Transaction Reminders</h3>
          <p className="text-xs text-muted-foreground">Get inbox alerts for recurring payments</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-semibold text-xs transition-colors ${showForm ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground hover:opacity-90'}`}>
          <Bell className="w-3.5 h-3.5" />{showForm ? 'Cancel' : 'New Reminder'}
        </button>
      </div>

      {showForm && (
        <div className="p-4 border border-border rounded-2xl bg-card space-y-4">
          <h4 className="font-bold text-sm">New Reminder</h4>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Label</label>
            <input type="text" maxLength={80} placeholder="e.g. Pay rent, Send allowance…" value={label} onChange={e => setLabel(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Amount (USD, optional)</label>
              <input type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Recipient (optional)</label>
              <input type="text" maxLength={40} placeholder="@username" value={toUsername} onChange={e => setToUsername(e.target.value.replace(/^@/,''))}
                className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Frequency</label>
            <div className="grid grid-cols-3 gap-2">
              {FREQ_OPTIONS.map(f => (
                <button key={f} onClick={() => setFrequency(f)}
                  className={`py-2.5 rounded-xl font-bold text-xs border-2 transition-all ${frequency === f ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'}`}>
                  {FREQ_LABELS[f]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Remind At</label>
            <input type="datetime-local" min={minDateTime} value={remindAt} onChange={e => setRemindAt(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <button onClick={createReminder} disabled={saving || !label.trim() || !remindAt}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Set Reminder'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : reminders.length === 0 ? (
        <div className="text-center py-12">
          <Bell className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
          <p className="font-semibold text-sm">No reminders set</p>
          <p className="text-xs text-muted-foreground mt-1">Add a reminder to stay on top of payments</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reminders.map(r => {
            const due = new Date(r.remind_at);
            const isPast = due.getTime() < Date.now();
            return (
              <div key={r.id} className={`p-4 border rounded-2xl bg-card ${isPast ? 'border-amber-500/40 bg-amber-500/5' : 'border-border'}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isPast ? 'bg-amber-500/15' : 'bg-primary/10'}`}>
                      <Bell className={`w-4 h-4 ${isPast ? 'text-amber-500' : 'text-primary'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">{r.label}</p>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted font-semibold text-muted-foreground">{FREQ_LABELS[r.frequency]}</span>
                        {r.amount && <span className="text-[10px] text-primary font-bold">{fmtAmt(Number(r.amount), currency)}</span>}
                        {r.to_username && <span className="text-[10px] text-muted-foreground">→ @{r.to_username}</span>}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => deleteReminder(r.id)} className="text-muted-foreground hover:text-destructive ml-2 shrink-0"><X className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    <span className={isPast ? 'text-amber-600 font-semibold' : ''}>
                      {isPast ? '⚠️ Overdue · ' : ''}{due.toLocaleDateString()} {due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <button onClick={() => dispatchNow(r)} disabled={dispatching === r.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-xl font-bold text-xs hover:opacity-90 disabled:opacity-50 transition-opacity">
                    {dispatching === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : (r.to_username ? <Send className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />)}
                    {r.to_username ? 'Send Now' : 'Remind Me'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
