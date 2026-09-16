import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Loader2, Star, X, ArrowDownLeft, RefreshCw } from 'lucide-react';

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

const SAVINGS_GOAL_EMOJIS = ['🎯','🏠','✈️','🎓','💻','🚗','💍','🌴','🎸','👶','🏋️','📱'] as const;
const SAVINGS_COLORS     = ['blue','green','purple','amber','red','pink'] as const;
const SAVINGS_AUTO_FREQ  = ['weekly','monthly'] as const;
// Pure helpers replace Record<string,string> module-scope objects (esbuild guard)
function getGoalBg(c: string): string {
  if (c === 'green')  return 'from-green-500/10 to-green-400/5 border-green-500/20';
  if (c === 'purple') return 'from-purple-500/10 to-purple-400/5 border-purple-500/20';
  if (c === 'amber')  return 'from-amber-500/10 to-amber-400/5 border-amber-500/20';
  if (c === 'red')    return 'from-red-500/10 to-red-400/5 border-red-500/20';
  if (c === 'pink')   return 'from-pink-500/10 to-pink-400/5 border-pink-500/20';
  return 'from-blue-500/10 to-blue-400/5 border-blue-500/20';
}
function getGoalBar(c: string): string {
  if (c === 'green')  return 'bg-green-500';
  if (c === 'purple') return 'bg-purple-500';
  if (c === 'amber')  return 'bg-amber-500';
  if (c === 'red')    return 'bg-red-500';
  if (c === 'pink')   return 'bg-pink-500';
  return 'bg-blue-500';
}
function getGoalText(c: string): string {
  if (c === 'green')  return 'text-green-600';
  if (c === 'purple') return 'text-purple-600';
  if (c === 'amber')  return 'text-amber-600';
  if (c === 'red')    return 'text-red-500';
  if (c === 'pink')   return 'text-pink-600';
  return 'text-blue-600';
}

interface Props {
  userId: string;
  walletBalance: number;
  currency: CurrencyCode;
}

export default function SavingsGoalsTab({ userId, walletBalance, currency }: Props) {
  const [goals,       setGoals]      = useState<any[]>([]);
  const [loading,     setLoading]    = useState(true);
  const [showForm,    setShowForm]   = useState(false);
  const [name,        setName]       = useState('');
  const [target,      setTarget]     = useState('');
  const [deadline,    setDeadline]   = useState('');
  const [emoji,       setEmoji]      = useState('🎯');
  const [color,       setColor]      = useState('blue');
  const [saving,      setSaving]     = useState(false);
  const [depositing,    setDepositing]    = useState<string | null>(null);
  // depositAmt: parallel arrays (esbuild guard: no Record<string,string> in state)
  const [depositAmtIds, setDepositAmtIds] = useState<string[]>([]);
  const [depositAmtVals, setDepositAmtVals] = useState<string[]>([]);
  const getDepositAmt = (id: string) => { const i = depositAmtIds.indexOf(id); return i >= 0 ? depositAmtVals[i] : ''; };
  const setDepositAmtFor = (id: string, val: string) => {
    setDepositAmtIds(prev => {
      const i = prev.indexOf(id);
      if (i >= 0) { setDepositAmtVals(pv => { const n = [...pv]; n[i] = val; return n; }); return prev; }
      setDepositAmtVals(pv => [...pv, val]);
      return [...prev, id];
    });
  };
  const [autoFundGoal,  setAutoFundGoal]  = useState<string | null>(null);
  const [autoFundFreq,  setAutoFundFreq]  = useState<'weekly' | 'monthly'>('weekly');
  const [autoFundAmt,   setAutoFundAmt]   = useState('');
  const [savingAuto,    setSavingAuto]    = useState(false);
  // existingAuto: parallel arrays (esbuild guard)
  const [autoFundGoalIds, setAutoFundGoalIds] = useState<string[]>([]);
  const [autoFundGoalData, setAutoFundGoalData] = useState<any[]>([]);
  const getExistingAuto = (id: string) => { const i = autoFundGoalIds.indexOf(id); return i >= 0 ? autoFundGoalData[i] : null; };
  const setExistingAutoFor = (id: string, data: any) => {
    setAutoFundGoalIds(prev => {
      const i = prev.indexOf(id);
      if (i >= 0) { setAutoFundGoalData(pd => { const n = [...pd]; n[i] = data; return n; }); return prev; }
      setAutoFundGoalData(pd => [...pd, data]);
      return [...prev, id];
    });
  };

  const minDateTime = useMemo(() => {
    const d = new Date(Date.now() + 60000);
    return d.toISOString().slice(0, 16);
  }, []);

  useEffect(() => { loadGoals(); loadAutoFunds(); }, [userId]);

  const loadAutoFunds = async () => {
    const { data } = await supabase.from('transaction_reminders')
      .select('*').eq('user_id', userId).eq('is_active', true)
      .ilike('label', 'Auto-fund:%');
    // Use parallel arrays instead of map object (esbuild guard)
    const newIds: string[] = [];
    const newData: any[] = [];
    (data ?? []).forEach((r: any) => {
      const match = (r.label as string).match(/Auto-fund:([\w-]+)/);
      if (match) { newIds.push(match[1]); newData.push(r); }
    });
    setAutoFundGoalIds(newIds);
    setAutoFundGoalData(newData);
  };

  const loadGoals = async () => {
    setLoading(true);
    const { data } = await supabase.from('savings_goals').select('*')
      .eq('user_id', userId).order('created_at', { ascending: false });
    setGoals(data ?? []);
    setLoading(false);
  };

  const createGoal = async () => {
    if (!name.trim() || !target || parseFloat(target) <= 0) { toast.error('Enter a name and target amount'); return; }
    setSaving(true);
    const { error } = await supabase.from('savings_goals').insert({
      user_id: userId, name: name.trim(), target_amount: parseFloat(target),
      deadline: deadline || null, emoji, color,
    });
    setSaving(false);
    if (error) { toast.error('Failed to create goal'); return; }
    toast.success('Savings goal created!');
    setShowForm(false); setName(''); setTarget(''); setDeadline(''); setEmoji('🎯'); setColor('blue');
    loadGoals();
  };

  const depositToGoal = async (goal: any) => {
    const amt = parseFloat(getDepositAmt(goal.id) || '0');
    if (!amt || amt <= 0) { toast.error('Enter an amount to add'); return; }
    if (amt > walletBalance) { toast.error('Insufficient wallet balance'); return; }
    setDepositing(goal.id);
    const newAmt = Number(goal.current_amount) + amt;
    const isComplete = newAmt >= Number(goal.target_amount);
    const { error } = await supabase.from('savings_goals').update({
      current_amount: newAmt, is_completed: isComplete, updated_at: new Date().toISOString(),
    }).eq('id', goal.id);
    if (!error && isComplete) {
      supabase.from('platform_inbox').insert({
        user_id: userId,
        subject: `🎉 Goal achieved: ${goal.emoji} ${goal.name}`,
        body: `You reached your savings goal of ${fmtAmt(Number(goal.target_amount), currency)}!`,
        type: 'news', icon_emoji: '🎉', cta_label: 'View Wallet', cta_url: '/wallet?tab=savings',
      }).then(() => {});
    }
    setDepositing(null);
    if (error) { toast.error('Failed to update goal'); return; }
    toast.success(isComplete ? '🎉 Goal reached!' : `Added ${fmtAmt(amt, currency)} to goal!`);
    setDepositAmtFor(goal.id, '');
    loadGoals();
  };

  const deleteGoal = async (id: string) => {
    const { error } = await supabase.from('savings_goals').delete().eq('id', id);
    if (error) { toast.error('Failed to delete'); return; }
    toast.success('Goal removed'); loadGoals();
  };

  const saveAutoFund = async (goalId: string) => {
    const amt = parseFloat(autoFundAmt || '0');
    if (!amt || amt <= 0) { toast.error('Enter a valid auto-fund amount'); return; }
    setSavingAuto(true);
    // Remove any existing auto-fund for this goal
    const existingAutoEntry = getExistingAuto(goalId);
    if (existingAutoEntry) {
      await supabase.from('transaction_reminders').update({ is_active: false }).eq('id', existingAutoEntry.id);
    }
    const nextDate = new Date(Date.now() + (autoFundFreq === 'weekly' ? 7 : 30) * 86400000);
    nextDate.setHours(9, 0, 0, 0);
    const { error } = await supabase.from('transaction_reminders').insert({
      user_id: userId, label: `Auto-fund:${goalId}`,
      amount: amt, to_username: null, frequency: autoFundFreq,
      next_reminder_at: nextDate.toISOString(),
    });
    setSavingAuto(false);
    if (error) { toast.error('Failed to set auto-fund'); return; }
    toast.success(`Auto-fund ${autoFundFreq === 'weekly' ? 'weekly' : 'monthly'} set!`);
    setAutoFundGoal(null); setAutoFundAmt('');
    loadAutoFunds();
  };

  const removeAutoFund = async (goalId: string) => {
    const r = getExistingAuto(goalId);
    if (!r) return;
    await supabase.from('transaction_reminders').update({ is_active: false }).eq('id', r.id);
    toast.success('Auto-fund removed');
    loadAutoFunds();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm">Savings Goals</h3>
          <p className="text-xs text-muted-foreground">Track progress toward financial milestones</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-semibold text-xs transition-colors ${showForm ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground hover:opacity-90'}`}>
          <Star className="w-3.5 h-3.5" />{showForm ? 'Cancel' : 'New Goal'}
        </button>
      </div>

      {showForm && (
        <div className="p-4 border border-border rounded-2xl bg-card space-y-4">
          <h4 className="font-bold text-sm">Create Savings Goal</h4>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Emoji</label>
            <div className="flex flex-wrap gap-2">
              {SAVINGS_GOAL_EMOJIS.map(e => (
                <button key={e} onClick={() => setEmoji(e)}
                  className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center border-2 transition-all ${emoji === e ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'}`}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Color</label>
            <div className="flex gap-2">
              {SAVINGS_COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full border-4 transition-all ${getGoalBar(c)} ${color === c ? 'border-foreground scale-110' : 'border-transparent opacity-60 hover:opacity-100'}`} />
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Goal Name</label>
            <input type="text" maxLength={60} placeholder="e.g. New Laptop, Vacation…" value={name} onChange={e => setName(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Target Amount (USD)</label>
            <input type="number" min="1" step="0.01" placeholder="0.00" value={target} onChange={e => setTarget(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Deadline (optional)</label>
            <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <button onClick={createGoal} disabled={saving || !name.trim() || !target || parseFloat(target) <= 0}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
            {saving ? 'Creating…' : 'Create Goal'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : goals.length === 0 ? (
        <div className="text-center py-12">
          <Star className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
          <p className="font-semibold text-sm">No savings goals yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create your first goal above</p>
        </div>
      ) : (
        <div className="space-y-4">
          {goals.map(g => {
            const pct       = Math.min((Number(g.current_amount) / Number(g.target_amount)) * 100, 100);
            const remaining = Math.max(Number(g.target_amount) - Number(g.current_amount), 0);
            const bg   = getGoalBg(g.color);
            const bar  = getGoalBar(g.color);
            const txt  = getGoalText(g.color);
            return (
              <div key={g.id} className={`p-4 rounded-2xl bg-gradient-to-br border ${bg}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{g.emoji}</span>
                    <div>
                      <p className="font-bold text-sm">{g.name}</p>
                      {g.deadline && (
                        <p className="text-[10px] text-muted-foreground">Due {new Date(g.deadline + 'T00:00:00').toLocaleDateString()}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {g.is_completed && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-600 font-bold border border-green-500/25">✅ Done</span>}
                    <button onClick={() => deleteGoal(g.id)} className="text-muted-foreground hover:text-destructive transition-colors"><X className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div className="space-y-1.5 mb-3">
                  <div className="flex justify-between text-xs">
                    <span className={`font-black ${txt}`}>{fmtAmt(Number(g.current_amount), currency)}</span>
                    <span className="text-muted-foreground">of {fmtAmt(Number(g.target_amount), currency)}</span>
                  </div>
                  <div className="h-2.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${bar}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{pct.toFixed(1)}% complete</span>
                    {remaining > 0 && <span>{fmtAmt(remaining, currency)} to go</span>}
                  </div>
                </div>
                {!g.is_completed && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input type="number" min="0.01" step="0.01" placeholder="Add funds (USD)…"
                        value={getDepositAmt(g.id)} onChange={e => setDepositAmtFor(g.id, e.target.value)}
                        className="flex-1 h-9 px-3 rounded-xl border border-border/60 bg-background/80 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      <button onClick={() => depositToGoal(g)} disabled={depositing === g.id}
                        className={`px-4 h-9 rounded-xl font-bold text-xs text-white disabled:opacity-50 flex items-center gap-1 ${bar} hover:opacity-90 transition-opacity`}>
                        {depositing === g.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
                        Add
                      </button>
                    </div>
                    {/* Auto-Fund */}
                    {getExistingAuto(g.id) ? (
                      <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl text-xs">
                        <RefreshCw className="w-3 h-3 text-primary shrink-0" />
                        <span className="flex-1 text-primary font-semibold">
                          Auto-fund ${Number(getExistingAuto(g.id).amount).toFixed(2)} {getExistingAuto(g.id).frequency}
                        </span>
                        <button onClick={() => removeAutoFund(g.id)} className="text-muted-foreground hover:text-destructive">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : autoFundGoal === g.id ? (
                      <div className="p-3 border border-primary/20 bg-primary/5 rounded-xl space-y-2">
                        <p className="text-xs font-bold">Set Auto-Fund</p>
                        <div className="grid grid-cols-2 gap-2">
                          {SAVINGS_AUTO_FREQ.map(f => (
                            <button key={f} onClick={() => setAutoFundFreq(f)}
                              className={`py-2 rounded-xl font-bold text-xs border-2 capitalize transition-all ${autoFundFreq === f ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'}`}>
                              {f}
                            </button>
                          ))}
                        </div>
                        <input type="number" min="0.01" step="0.01" placeholder="Amount per cycle (USD)…"
                          value={autoFundAmt} onChange={e => setAutoFundAmt(e.target.value)}
                          className="w-full h-9 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        <div className="flex gap-2">
                          <button onClick={() => setAutoFundGoal(null)} className="flex-1 py-2 border border-border rounded-xl font-semibold text-xs hover:bg-muted">Cancel</button>
                          <button onClick={() => saveAutoFund(g.id)} disabled={savingAuto}
                            className="flex-1 py-2 bg-primary text-primary-foreground rounded-xl font-bold text-xs disabled:opacity-50 flex items-center justify-center gap-1">
                            {savingAuto ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setAutoFundGoal(g.id); setAutoFundAmt(''); }}
                        className="w-full flex items-center justify-center gap-1.5 py-2 border border-border rounded-xl font-semibold text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors">
                        <RefreshCw className="w-3 h-3" /> Set Auto-Fund
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
