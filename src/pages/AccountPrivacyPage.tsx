import { useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Loader2, LockKeyhole, PauseCircle, Shield, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

export default function AccountPrivacyPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState<'deactivate' | 'delete' | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const runLifecycleAction = async (action: 'deactivate' | 'delete') => {
    if (!user || busy) return;
    if (action === 'delete' && confirm !== 'DELETE') {
      toast.error('Type DELETE to confirm permanent account deletion');
      return;
    }
    setBusy(action);
    const { data, error } = await supabase.functions.invoke('account-lifecycle', {
      body: { action, confirmation: action === 'delete' ? confirm : undefined },
    });
    setBusy(null);
    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? 'Account action failed');
      return;
    }
    if (action === 'delete') {
      toast.success('Your account has been permanently deleted');
    } else {
      toast.success('Your account has been deactivated');
    }
    await supabase.auth.signOut({ scope: 'global' });
    navigate('/auth', { replace: true });
  };

  if (!user) {
    return <div className="min-h-screen bg-background flex items-center justify-center px-4"><div className="text-center"><h1 className="font-bold text-lg">Sign in to manage account privacy</h1><button onClick={() => navigate('/auth')} className="mt-4 px-5 py-2 rounded-full bg-primary text-primary-foreground font-semibold">Sign in</button></div></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/90 backdrop-blur-xl">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center"><ArrowLeft className="w-5 h-5" /></button>
          <div className="min-w-0 flex-1"><h1 className="font-bold text-base">Privacy & Account</h1><p className="text-[11px] text-muted-foreground">Control your account lifecycle and security</p></div>
          <Shield className="w-5 h-5 text-primary" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 pb-12 space-y-5">
        <section className="rounded-3xl border border-border bg-background p-5 shadow-sm">
          <div className="flex items-start gap-3"><div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><LockKeyhole className="w-5 h-5" /></div><div><h2 className="font-bold">Account controls</h2><p className="text-sm text-muted-foreground mt-1 leading-5">These controls are separate from your profile feature toggles. Your profile features decide what modules appear; these controls decide the lifecycle of your account.</p></div></div>
          <div className="mt-5 grid gap-3">
            <button disabled={!!busy} onClick={() => void runLifecycleAction('deactivate')} className="w-full rounded-2xl border border-border p-4 text-left hover:bg-muted/30 disabled:opacity-60 transition-colors flex items-start gap-3">
              <PauseCircle className="w-5 h-5 mt-0.5 text-amber-500 shrink-0" /><div className="min-w-0 flex-1"><div className="font-bold text-sm">Deactivate account</div><p className="text-xs text-muted-foreground mt-1">Hide your account while retaining your account data for recovery.</p></div>{busy === 'deactivate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 text-muted-foreground" />}
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex items-start gap-3"><div className="w-10 h-10 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0"><Trash2 className="w-5 h-5" /></div><div className="min-w-0"><h2 className="font-bold text-destructive">Delete account permanently</h2><p className="text-sm text-muted-foreground mt-1 leading-5">This is irreversible. Your authenticated account is deleted server-side after explicit confirmation. Financial or legally retained records are governed by their applicable retention policy.</p></div></div>

          {!deleteOpen ? (
            <button onClick={() => setDeleteOpen(true)} className="mt-5 w-full h-11 rounded-2xl border border-destructive/40 text-destructive font-bold text-sm hover:bg-destructive/10 transition-colors">Continue to permanent deletion</button>
          ) : (
            <div className="mt-5 rounded-2xl border border-destructive/30 bg-background p-4 space-y-4">
              <div className="flex items-start gap-2 text-sm"><AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" /><p>There is no recovery after deletion. Type <strong>DELETE</strong> exactly to confirm.</p></div>
              <input value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Type DELETE" aria-label="Type DELETE to confirm account deletion" className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-destructive/30" />
              <div className="flex gap-3"><button onClick={() => { setDeleteOpen(false); setConfirm(''); }} disabled={!!busy} className="flex-1 h-11 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancel</button><button onClick={() => void runLifecycleAction('delete')} disabled={busy === 'delete' || confirm !== 'DELETE'} className="flex-1 h-11 rounded-xl bg-destructive text-destructive-foreground font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">{busy === 'delete' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete permanently</button></div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
