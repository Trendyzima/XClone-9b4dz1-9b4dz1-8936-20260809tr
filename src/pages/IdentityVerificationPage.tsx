import { useEffect, useState } from 'react';
import { DiditSdk } from '@didit-protocol/sdk-web';
import { CheckCircle2, Clock3, ExternalLink, Loader2, ShieldCheck, XCircle, KeyRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useSEO } from '@/hooks/useSEO';
import { finalizeAuthenticatedSession } from '@/lib/auth';
import { identitySignup, type IdentitySignupStatus } from '@/lib/identitySignup';

export default function IdentityVerificationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  useSEO({ noindex: true, title: 'Identity verification · Testagram', url: '/verify-identity' });

  const [status, setStatus] = useState<IdentitySignupStatus['status']>('pending');
  const [diditStatus, setDiditStatus] = useState('Not Started');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [message, setMessage] = useState('');
  const [verificationRunning, setVerificationRunning] = useState(false);
  const [verificationFinished, setVerificationFinished] = useState(false);

  const loadStatus = async () => {
    try {
      const result = await identitySignup.status();
      setStatus(result.status);
      setDiditStatus(result.didit_status || 'Not Started');
      setMessage('');
    } catch (error: any) {
      const code = String(error?.message || '');
      if (code !== 'REGISTRATION_TOKEN_REQUIRED') {
        setMessage(code || 'We could not load your identity verification status.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      setLoading(true);
      setMessage('');
      try {
        // Existing authenticated users may arrive here from login without a
        // browser registration token. Mint the short-lived server-side intent
        // first; never manufacture or trust a token in the browser.
        if (user && !identitySignup.token()) {
          const result = await identitySignup.startExisting();
          if (cancelled) return;
          if (result.already_approved) {
            setStatus('approved');
            setDiditStatus('Approved');
            return;
          }
        }
        if (!cancelled) await loadStatus();
      } catch (error: any) {
        if (!cancelled) {
          const code = String(error?.message || '');
          setMessage(code === 'REGISTRATION_TOKEN_REQUIRED'
            ? 'Identity verification could not be resumed. Start verification again from this page.'
            : code || 'We could not start identity verification.');
          setLoading(false);
        }
      }
    };
    void bootstrap();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (!identitySignup.token()) return;
    const timer = window.setInterval(() => { void loadStatus(); }, 5000);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  useEffect(() => {
    return () => {
      DiditSdk.shared.onComplete = undefined;
      DiditSdk.shared.onStateChange = undefined;
      DiditSdk.shared.onEvent = undefined;
      DiditSdk.shared.destroy();
    };
  }, []);

  const start = async () => {
    if (verificationRunning) return;
    setStarting(true);
    setMessage('');
    setVerificationFinished(false);
    try {
      const result = user ? await identitySignup.startExisting() : await identitySignup.createIdentitySession();
      if (result.already_approved) {
        await loadStatus();
        return;
      }
      if (!result.url) throw new Error('DIDIT_SESSION_URL_MISSING');

      setVerificationRunning(true);
      DiditSdk.shared.onComplete = (completion) => {
        setVerificationRunning(false);
        if (completion.type === 'completed') {
          setVerificationFinished(true);
          void loadStatus();
          return;
        }
        if (completion.type === 'cancelled') {
          setMessage('Verification was closed before completion. Your verification is still pending.');
          return;
        }
        setMessage(completion.error?.message || 'The verification flow could not be completed.');
      };
      DiditSdk.shared.onStateChange = (state, error) => {
        if (state === 'error') {
          setVerificationRunning(false);
          setMessage(error || DiditSdk.shared.errorMessage || 'The verification flow could not be loaded.');
        }
      };
      DiditSdk.shared.startVerification({
        url: result.url,
        configuration: {
          showCloseButton: true,
          showExitConfirmation: true,
          closeModalOnComplete: true,
          defaultDocumentCamera: 'back',
          defaultLivenessCamera: 'front',
          showDocumentCameraSwitchButton: true,
          showLivenessCameraSwitchButton: true,
        },
      });
    } catch (error: any) {
      setVerificationRunning(false);
      setMessage(error?.message || 'We could not start identity verification.');
    } finally {
      setStarting(false);
    }
  };

  const continueAfterVerification = async () => {
    setMessage('');
    setFinalizing(true);
    try {
      await loadStatus();
      const latest = await identitySignup.status();
      if (latest.status !== 'approved') {
        setMessage(latest.status === 'under_review' || latest.didit_status === 'In Review'
          ? 'Verification is still under review. Testagram will not continue until Didit approves it.'
          : 'Verification has not been approved yet. Complete every requested step first.');
        return;
      }
      if (user) {
        navigate('/', { replace: true });
      } else {
        setVerificationFinished(false);
      }
    } catch (error: any) {
      setMessage(error?.message || 'We could not confirm the verification result yet.');
    } finally {
      setFinalizing(false);
    }
  };

  const finalize = async () => {
    if (password.length < 8 || password !== confirmation) {
      setMessage(password !== confirmation ? 'Passwords do not match.' : 'Use at least 8 characters.');
      return;
    }
    setFinalizing(true);
    setMessage('');
    try {
      const createdUser = await identitySignup.finalize(password);
      const finalized = await finalizeAuthenticatedSession(createdUser);
      login(finalized);
      navigate('/', { replace: true });
    } catch (error: any) {
      setMessage(error?.message || 'Account creation could not be completed.');
    } finally {
      setFinalizing(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const rejected = status === 'rejected' || status === 'blocked';
  const underReview = status === 'under_review' || diditStatus === 'In Review';
  const approved = status === 'approved';

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,hsl(var(--primary)/.12),transparent_42%),hsl(var(--background))] p-4 sm:p-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10"><ShieldCheck className="h-6 w-6 text-primary" /></div>
          <div><p className="text-xs font-black uppercase tracking-[.18em] text-primary">Testagram security</p><h1 className="text-2xl font-black">Identity verification</h1></div>
        </div>

        <div className="rounded-3xl border bg-card p-5 shadow-xl sm:p-7">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6">
            <p className="font-bold">One person, one Testagram account.</p>
            <p className="mt-1 text-muted-foreground">Your Kenyan national ID is verified by Didit using the front and back document capture plus liveness/face checks. Testagram does not receive or store the document photos. We keep only the verification outcome and a protected ID uniqueness fingerprint.</p>
          </div>

          {verificationFinished && !approved && !underReview && !rejected && (
            <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <p className="font-bold">Verification flow finished</p>
              <p className="mt-1 text-sm text-muted-foreground">Didit has finished the capture flow. Testagram will only continue after you explicitly press the button below and the server confirms the verification decision.</p>
              <button disabled={finalizing} onClick={continueAfterVerification} className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-primary px-4 font-black text-primary-foreground disabled:opacity-50">
                {finalizing ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Done — check verification and continue'}
              </button>
            </div>
          )}

          {underReview && (
            <div className="mt-5 flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div><p className="font-bold">Verification is under review</p><p className="text-sm text-muted-foreground">Didit has flagged the verification for manual review. Testagram will not create or unlock the account until the result is approved.</p></div>
            </div>
          )}

          {rejected && (
            <div className="mt-5 flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div><p className="font-bold">Identity verification was not approved</p><p className="text-sm text-muted-foreground">{message || 'Start a new verification session with the correct Kenyan national ID.'}</p></div>
            </div>
          )}

          {approved && !user && (
            <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              <h2 className="mt-3 text-xl font-black">Identity verified — finish creating your account</h2>
              <p className="mt-1 text-sm text-muted-foreground">Your ID verification passed. Now choose the password for your new Testagram account. The account is created only after this step.</p>
              <div className="mt-5 space-y-3">
                <div className="relative"><KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (8+ characters)" className="h-12 w-full rounded-2xl border bg-background pl-11 pr-4" /></div>
                <div className="relative"><KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="Confirm password" className="h-12 w-full rounded-2xl border bg-background pl-11 pr-4" /></div>
                <button disabled={finalizing} onClick={finalize} className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 font-black text-primary-foreground disabled:opacity-50">{finalizing ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Create my Testagram account'}</button>
              </div>
            </div>
          )}

          {!approved && !underReview && !verificationFinished && (
            <div className="mt-6">
              <button disabled={starting || verificationRunning} onClick={start} className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 font-black text-primary-foreground disabled:opacity-50">
                {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <><ExternalLink className="h-5 w-5" />Verify with Didit</>}
              </button>
              <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">Didit opens inside Testagram and stays open while you complete every requested step. Do not close it until you have finished the document front, document back, and liveness/face checks. Testagram will not redirect you automatically.</p>
            </div>
          )}

          {user && approved && (
            <button onClick={() => navigate('/', { replace: true })} className="mt-6 flex h-13 w-full items-center justify-center rounded-2xl bg-primary px-4 font-black text-primary-foreground">Continue to Testagram</button>
          )}

          {message && !rejected && <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-700">{message}</p>}

          <div className="mt-6 border-t pt-5 text-xs leading-5 text-muted-foreground">
            <p><strong>Privacy by design:</strong> Testagram does not upload national-ID photos to Supabase Storage and does not persist the document images in its database.</p>
            <p className="mt-2">The provider session is deleted after a terminal verification result is processed, so the verification media is not retained by the Testagram system after verification. Didit supports session deletion that removes the decision, extracted data and all stored media.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
