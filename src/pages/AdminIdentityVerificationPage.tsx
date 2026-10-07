import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, FileImage, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useGovernance } from '@/lib/governance';
import { useSEO } from '@/hooks/useSEO';

type Row = {
  id: string; user_id: string; id_number_last4: string; country_code: string;
  front_object_path: string; back_object_path: string; status: string;
  submitted_at: string; username: string; display_name: string | null; email: string | null;
  rejection_reason: string | null;
};

export default function AdminIdentityVerificationPage() {
  const { user } = useAuth();
  const { governance, loading: governanceLoading } = useGovernance();
  const navigate = useNavigate();
  useSEO({ noindex: true, title: 'Identity verification queue · Testagram', url: '/admin/identity-verification' });
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, { front: string; back: string }>>({});

  const load = async () => {
    if (!user || !governance.is_owner) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('list_identity_verifications_for_owner');
    if (error) { console.error(error); setRows([]); setLoading(false); return; }
    const next = (data || []) as Row[];
    setRows(next);
    const signed: Record<string, { front: string; back: string }> = {};
    for (const row of next) {
      const [front, back] = await Promise.all([
        supabase.storage.from('identity-documents').createSignedUrl(row.front_object_path, 300),
        supabase.storage.from('identity-documents').createSignedUrl(row.back_object_path, 300),
      ]);
      if (front.data?.signedUrl && back.data?.signedUrl) signed[row.id] = { front: front.data.signedUrl, back: back.data.signedUrl };
    }
    setUrls(signed);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) { navigate('/auth', { replace: true }); return; }
    if (!governanceLoading && !governance.is_owner) navigate('/admin/governance', { replace: true });
    if (!governanceLoading && governance.is_owner) void load();
  }, [user?.id, governanceLoading, governance.is_owner]);

  const decide = async (row: Row, decision: 'approved' | 'rejected' | 'blocked') => {
    setBusy(row.id);
    const { error } = await supabase.rpc('review_identity_verification', {
      p_verification_id: row.id,
      p_decision: decision,
      p_notes: decision === 'rejected' ? 'Identity documents could not be verified.' : null,
    });
    if (!error) await load();
    else console.error(error);
    setBusy(null);
  };

  if (!user || governanceLoading || loading) return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const pending = rows.filter(r => ['submitted','under_review'].includes(r.status));

  return (
    <main className="min-h-screen bg-background p-4 sm:p-7">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10"><ShieldCheck className="h-6 w-6 text-primary" /></div><div><h1 className="text-2xl font-black">Identity verification queue</h1><p className="text-sm text-muted-foreground">{pending.length} awaiting review · private ID documents</p></div></div>
          <button onClick={() => void load()} className="rounded-xl border p-3 hover:bg-muted"><RefreshCw className="h-4 w-4" /></button>
        </div>

        {pending.length === 0 && <div className="rounded-3xl border bg-card p-12 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" /><p className="mt-3 font-bold">No pending identity reviews</p></div>}

        <div className="space-y-5">
          {pending.map(row => (
            <article key={row.id} className="rounded-3xl border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><p className="font-black">@{row.username}</p><p className="text-sm text-muted-foreground">{row.email || 'No email'} · ID ending {row.id_number_last4}</p><p className="mt-1 text-xs text-muted-foreground flex items-center gap-1"><Clock3 className="h-3 w-3" />Submitted {new Date(row.submitted_at).toLocaleString()}</p></div>
                <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-700">{row.status}</span>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {(['front','back'] as const).map(side => (
                  <div key={side} className="overflow-hidden rounded-2xl border bg-muted/20">
                    <p className="border-b px-3 py-2 text-xs font-black uppercase tracking-widest">{side} of ID</p>
                    {urls[row.id]?.[side] ? <img src={urls[row.id][side]} alt={side + ' of identity document'} className="max-h-[420px] w-full object-contain bg-black/5" /> : <div className="flex h-64 items-center justify-center text-muted-foreground"><FileImage className="h-8 w-8" /></div>}
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button disabled={busy === row.id} onClick={() => void decide(row,'approved')} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />Approve</button>
                <button disabled={busy === row.id} onClick={() => void decide(row,'rejected')} className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-3 font-bold text-white disabled:opacity-50"><XCircle className="h-4 w-4" />Reject</button>
                <button disabled={busy === row.id} onClick={() => void decide(row,'blocked')} className="rounded-xl border border-red-500/40 px-4 py-3 font-bold text-red-600 disabled:opacity-50">Block identity</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
