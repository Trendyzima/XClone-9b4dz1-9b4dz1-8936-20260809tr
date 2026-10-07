import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock3, FileImage, Loader2, ShieldCheck, Upload, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useSEO } from '@/hooks/useSEO';

type Status = 'pending' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'blocked' | 'not_required';

const MAX_FILE = 8 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp';

export default function IdentityVerificationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useSEO({ noindex: true, title: 'Identity verification · Testagram', url: '/verify-identity' });

  const [status, setStatus] = useState<Status>('pending');
  const [last4, setLast4] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);

  const loadStatus = async () => {
    if (!user) { navigate('/auth', { replace: true }); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc('get_my_identity_verification_status');
    if (!error && data) setStatus((data.status || 'pending') as Status);
    setLoading(false);
  };

  useEffect(() => { void loadStatus(); }, [user?.id]);

  if (!user || loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (status === 'approved') {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-5">
        <div className="w-full max-w-lg rounded-3xl border bg-card p-7 text-center shadow-xl">
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
          <h1 className="mt-4 text-2xl font-black">Identity verified</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your Testagram account is verified and your identity is bound to one account.</p>
          <button onClick={() => navigate('/', { replace: true })} className="mt-6 w-full rounded-2xl bg-primary px-4 py-3 font-bold text-primary-foreground">Continue to Testagram</button>
        </div>
      </main>
    );
  }

  const submitted = status === 'submitted' || status === 'under_review';
  const rejected = status === 'rejected';

  const validateFile = (file: File | null) => {
    if (!file) return 'Choose a document image.';
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) return 'Use JPG, PNG or WebP.';
    if (file.size > MAX_FILE) return 'Each image must be 8 MB or smaller.';
    return null;
  };

  const submit = async () => {
    if (!user) return;
    const normalized = nationalId.replace(/\D/g, '');
    if (!/^\d{6,12}$/.test(normalized)) { alert('Enter a valid national identification number.'); return; }
    if (validateFile(front) || validateFile(back)) { alert(validateFile(front) || validateFile(back)); return; }
    if (!acknowledged) { alert('Confirm the identity-verification notice before submitting.'); return; }

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('national_id', normalized);
      form.append('front', front!);
      form.append('back', back!);
      const { data, error } = await supabase.functions.invoke('submit-identity-verification', { body: form });
      if (error) throw error;
      if (data?.error === 'IDENTITY_ALREADY_REGISTERED') {
        alert('This national ID is already linked to another Testagram account. Only one account is allowed per identity.');
        return;
      }
      if (!data?.ok) throw new Error('Verification submission failed');
      setLast4(normalized.slice(-4));
      setStatus('submitted');
      setNationalId('');
      setFront(null);
      setBack(null);
      if (frontRef.current) frontRef.current.value = '';
      if (backRef.current) backRef.current.value = '';
    } catch (error: any) {
      alert(error?.message || 'We could not submit your verification. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,hsl(var(--primary)/.12),transparent_42%),hsl(var(--background))] p-4 sm:p-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10"><ShieldCheck className="h-6 w-6 text-primary" /></div>
          <div><p className="text-xs font-black uppercase tracking-[.18em] text-primary">Testagram security</p><h1 className="text-2xl font-black">Verify your identity</h1></div>
        </div>

        <div className="rounded-3xl border bg-card p-5 shadow-xl sm:p-7">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6">
            <p className="font-bold">One person, one Testagram account.</p>
            <p className="mt-1 text-muted-foreground">New accounts must submit a Kenyan national identification number and clear photos of both sides of the ID. The ID number is converted to a protected uniqueness fingerprint; the raw number is not stored in the verification record.</p>
          </div>

          {submitted && (
            <div className="mt-5 flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div><p className="font-bold">Verification submitted</p><p className="text-sm text-muted-foreground">Your documents are awaiting review. You cannot use the main Testagram app until verification is approved.</p>{last4 && <p className="mt-1 text-xs text-muted-foreground">ID ending in {last4}</p>}</div>
            </div>
          )}

          {rejected && (
            <div className="mt-5 flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div><p className="font-bold">Verification was not approved</p><p className="text-sm text-muted-foreground">Submit corrected documents below. The same identity can only belong to this account.</p></div>
            </div>
          )}

          {!submitted && status !== 'blocked' && (
            <div className="mt-6 space-y-5">
              <label className="block"><span className="mb-2 block text-sm font-bold">National identification number</span><input value={nationalId} onChange={e => setNationalId(e.target.value.replace(/\D/g,'').slice(0,12))} inputMode="numeric" autoComplete="off" className="h-12 w-full rounded-2xl border bg-background px-4 outline-none focus:ring-2 focus:ring-primary/30" placeholder="Enter your national ID number" /></label>

              <div className="grid gap-4 sm:grid-cols-2">
                {[['front','Front of ID',front,frontRef,setFront],['back','Back of ID',back,backRef,setBack]].map(([side,label,file,ref,setter]: any) => (
                  <div key={side}>
                    <p className="mb-2 text-sm font-bold">{label}</p>
                    <button type="button" onClick={() => ref.current?.click()} className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-muted/20 p-4 text-center hover:bg-muted/40">
                      {file ? <><CheckCircle2 className="h-8 w-8 text-emerald-600" /><span className="max-w-full truncate text-sm font-semibold">{file.name}</span><span className="text-xs text-muted-foreground">{(file.size/1024/1024).toFixed(2)} MB</span></> : <><Upload className="h-8 w-8 text-muted-foreground" /><span className="text-sm font-semibold">Upload clear photo</span><span className="text-xs text-muted-foreground">JPG, PNG or WebP · max 8 MB</span></>}
                    </button>
                    <input ref={ref} type="file" accept={ACCEPT} className="hidden" onChange={e => setter(e.target.files?.[0] || null)} />
                  </div>
                ))}
              </div>

              <label className="flex items-start gap-3 rounded-2xl border p-4 text-sm leading-6">
                <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} className="mt-1 h-4 w-4" />
                <span>I understand that Testagram processes my identity document for account uniqueness, identity verification, fraud prevention and security investigations, and that access is restricted to authorized verification/security personnel.</span>
              </label>

              <button disabled={submitting} onClick={submit} className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 font-black text-primary-foreground disabled:opacity-50">
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <><FileImage className="h-5 w-5" />Submit identity verification</>}
              </button>
            </div>
          )}

          {status === 'blocked' && <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/5 p-5 text-sm"><p className="font-bold text-red-600">Account verification blocked</p><p className="mt-1 text-muted-foreground">Contact Testagram support if you believe this was an error.</p></div>}

          <div className="mt-6 border-t pt-5 text-xs leading-5 text-muted-foreground">
            <p><strong>Security:</strong> document images are stored in a private storage bucket and are not public profile media.</p>
            <p className="mt-2">Testagram keeps security and verification records only for defined purposes and retention periods. Identity verification is a high-risk processing activity; the platform should maintain its DPIA and data-protection registration/records before production enforcement.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
