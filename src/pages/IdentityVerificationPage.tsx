import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, ShieldCheck, XCircle, Camera, Video, Upload, KeyRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useSEO } from '@/hooks/useSEO';
import { finalizeAuthenticatedSession } from '@/lib/auth';
import { identitySignup, type IdentitySignupStatus, type VerificationUpload } from '@/lib/identitySignup';

type EvidenceKind = 'id_front' | 'id_back' | 'selfie' | 'liveness_video';

const labels: Record<EvidenceKind,string> = {
  id_front: 'National ID — front',
  id_back: 'National ID — back',
  selfie: 'Selfie',
  liveness_video: 'Liveness video',
};

function friendlyIdentityError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    REGISTRATION_TOKEN_REQUIRED: 'Your registration session has expired. Return to sign up and start again.',
    REGISTRATION_EXPIRED: 'Your registration has expired. Start again to receive a new verification session.',
    REGISTRATION_COMPLETED: 'This registration has already been completed. Please sign in.',
    VERIFICATION_SESSION_REQUIRED: 'Your verification session is missing. Start a new verification attempt.',
    VERIFICATION_SESSION_EXPIRED: 'Your verification session expired. Start a new attempt to continue.',
    IDENTITY_SERVICE_UNAVAILABLE: 'Identity verification is temporarily unavailable. Please try again shortly.',
    IDENTITY_REQUEST_TIMEOUT: 'The request took too long. Check your connection and try again.',
    IDENTITY_NETWORK_ERROR: 'Could not reach the verification service. Check your connection and try again.',
    IDENTITY_REQUEST_FAILED: 'The verification request could not be completed. Please try again.',
    FILE_TOO_LARGE: 'Each evidence file must be 10 MB or smaller.',
    UNSUPPORTED_FILE_TYPE: 'Choose a supported image or video file.',
    UNSUPPORTED_VIDEO_CAPTURE: 'This browser cannot record the required liveness video format. Try a recent version of Chrome or another supported browser.',
    UPLOAD_SLOT_MISSING: 'The upload session expired. Start a new verification attempt.',
    MISSING_EVIDENCE: 'Capture all four verification items before continuing.',
    CAMERA_PERMISSION_DENIED: 'Allow camera access in your browser settings, then try again.',
    IDENTITY_NOT_APPROVED: 'Your identity has not been approved yet.',
  };
  if (messages[message]) return messages[message];
  if (message === 'NotAllowedError' || /permission denied/i.test(message)) return 'Allow camera access in your browser settings, then try again.';
  return fallback;
}

export default function IdentityVerificationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  useSEO({ noindex: true, title: 'Identity verification · Testagram', url: '/verify-identity' });

  const [status, setStatus] = useState<IdentitySignupStatus['status']>('pending');
  const [stage, setStage] = useState('Not started');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [uploads, setUploads] = useState<Partial<Record<EvidenceKind, VerificationUpload>>>({});
  const [uploaded, setUploaded] = useState<Partial<Record<EvidenceKind, boolean>>>({});
  const [processing, setProcessing] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [recording, setRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const fileRefs = useRef<Partial<Record<EvidenceKind, HTMLInputElement | null>>>({});

  const loadStatus = async () => {
    try {
      const result = await identitySignup.status();
      setStatus(result.status);
      setStage(result.verification_stage || 'pending');
      if (result.status === 'approved' || result.status === 'rejected' || result.status === 'blocked' || result.status === 'under_review') setProcessing(false);
      setMessage('');
    } catch (error: any) {
      const code = String(error?.message || '');
      if (code !== 'REGISTRATION_TOKEN_REQUIRED') setMessage(code || 'We could not load your verification status.');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    // This page belongs exclusively to the account-creation flow. A signed-in
    // user who reaches it through a stale bookmark, refresh, or old redirect
    // must never be forced back into KYC.
    if (user) {
      navigate('/', { replace: true });
      return () => { cancelled = true; };
    }
    (async () => {
      setLoading(true);
      try {
        if (!cancelled) await loadStatus();
      } catch (error: any) {
        if (!cancelled) { setMessage(error?.message || 'We could not start identity verification.'); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, navigate]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (identitySignup.token()) void loadStatus(); }, 5000);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  const start = async () => {
    if (starting) return;
    setStarting(true); setMessage('');
    try {
      const result = user ? await identitySignup.startExisting() : await identitySignup.createIdentitySession();
      if (result.already_approved) { await loadStatus(); return; }
      if (!result.session_token) throw new Error('VERIFICATION_SESSION_TOKEN_MISSING');
      const urlResult = await identitySignup.verification('upload_urls', { kinds: ['id_front','id_back','selfie','liveness_video'] });
      const next: Partial<Record<EvidenceKind, VerificationUpload>> = {};
      for (const item of (urlResult.uploads || [])) next[item.kind as EvidenceKind] = { kind:item.kind, path:item.path, token:item.token };
      setUploads(next);
      setUploaded({});
      setStatus('pending');
      setMessage('');
      setStage('capture');
    } catch (error: any) {
      setMessage(error?.message || 'We could not start your private verification session.');
    } finally { setStarting(false); }
  };

  const upload = async (kind: EvidenceKind, file: File) => {
    const target = uploads[kind];
    if (!target) throw new Error('UPLOAD_SLOT_MISSING');
    if (file.size > 10 * 1024 * 1024) throw new Error('FILE_TOO_LARGE');
    const mimeType = file.type.split(';')[0].trim().toLowerCase();
    const allowedTypes = kind === 'liveness_video' ? ['video/webm'] : ['image/jpeg', 'image/png', 'image/webp'];
    if (mimeType && !allowedTypes.includes(mimeType)) throw new Error('UNSUPPORTED_FILE_TYPE');
    await identitySignup.uploadEvidence(target, file);
    await identitySignup.verification('mark_uploaded', { kind, path: target.path });
    setUploaded(prev => ({...prev,[kind]:true}));
  };

  const captureFile = async (kind: EvidenceKind, file: File | undefined) => {
    if (!file) return;
    setMessage('');
    try { await upload(kind,file); } catch (error:any) { setMessage(friendlyIdentityError(error, 'Evidence upload failed.')); }
  };

  const startLiveness = async () => {
    if (!uploads.liveness_video || recording) return;
    setMessage('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});
      const supportedMimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!supportedMimeType) throw new Error('UNSUPPORTED_VIDEO_CAPTURE');
      const recorder = new MediaRecorder(stream, { mimeType: supportedMimeType });
      chunks.current = [];
      recorder.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        setRecording(false);
        const blob = new Blob(chunks.current, { type: 'video/webm' });
        try { await upload('liveness_video', new File([blob], 'liveness.webm', { type: 'video/webm' })); }
        catch (error:any) { setMessage(friendlyIdentityError(error, 'Liveness upload failed.')); }
      };
      mediaRecorder.current = recorder;
      recorder.start();
      setRecording(true);
      window.setTimeout(() => recorder.state === 'recording' && recorder.stop(), 5000);
    } catch (error:any) { setRecording(false); setMessage(friendlyIdentityError(error, 'Camera access is required for liveness.')); }
  };

  const beginProcessing = async () => {
    const required: EvidenceKind[] = ['id_front','id_back','selfie','liveness_video'];
    if (required.some(k => !uploaded[k])) { setMessage('Capture all four verification items before continuing.'); return; }
    setProcessing(true); setMessage('');
    try {
      await identitySignup.verification('begin_processing');
      setStage('processing');
      await loadStatus();
    } catch (error:any) { setProcessing(false); setMessage(friendlyIdentityError(error, 'We could not submit the verification for processing.')); }
  };

  useEffect(() => {
    if (recording && mediaRecorder.current?.state === 'inactive') setRecording(false);
  }, [recording]);

  const finalize = async () => {
    if (password.length < 8 || password !== confirmation) {
      setMessage(password !== confirmation ? 'Passwords do not match.' : 'Use at least 8 characters.');
      return;
    }
    setFinalizing(true); setMessage('');
    try {
      const createdUser = await identitySignup.finalize(password);
      const finalized = await finalizeAuthenticatedSession(createdUser);
      login(finalized);
      navigate('/', { replace: true });
    } catch (error:any) { setMessage(friendlyIdentityError(error, 'Account creation could not be completed.')); }
    finally { setFinalizing(false); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const rejected = status === 'rejected' || status === 'blocked';
  const underReview = status === 'under_review';
  const approved = status === 'approved';
  const captureReady = Object.keys(uploads).length === 4 && !processing;

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
            <p className="mt-1 text-muted-foreground">Testagram now performs the verification flow itself. Your Kenyan national ID is captured front and back, followed by selfie and liveness evidence. The raw evidence is private, processed by our own verification engine, and removed after the retention window.</p>
          </div>

          {rejected && <div className="mt-5 flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-4"><XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /><div><p className="font-bold">Identity verification was not approved</p><p className="text-sm text-muted-foreground">{message || 'Review the capture guidance, then start a fresh verification attempt.'}</p></div></div>}
          {underReview && <div className="mt-5 flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4"><Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div><p className="font-bold">Verification is under review</p><p className="text-sm text-muted-foreground">The local engine did not have enough confidence for automatic approval. Testagram will not create or unlock the account until review is complete.</p></div></div>}

          {!approved && !underReview && (!captureReady || rejected) && (
            <button disabled={starting} onClick={start} className="mt-6 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 font-black text-primary-foreground disabled:opacity-50">
              {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <><ShieldCheck className="h-5 w-5" />{rejected ? 'Start a new verification attempt' : 'Start private verification'}</>}
            </button>
          )}

          {!approved && !underReview && !rejected && captureReady && (
            <div className="mt-6 space-y-4">
              <p className="text-sm text-muted-foreground">Complete every capture below. The browser only uploads evidence; it cannot approve your identity.</p>
              {(['id_front','id_back','selfie'] as EvidenceKind[]).map(kind => (
                <div key={kind} className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between gap-3"><div><p className="font-bold">{labels[kind]}</p><p className="text-xs text-muted-foreground">{uploaded[kind] ? 'Captured and uploaded' : 'Use the camera or choose a file'}</p></div>{uploaded[kind] ? <CheckCircle2 className="h-5 w-5 text-emerald-600"/> : <Camera className="h-5 w-5 text-primary"/>}</div>
                  <input ref={el => {fileRefs.current[kind]=el}} type="file" accept="image/jpeg,image/png,image/webp" capture={kind==='selfie'?'user':'environment'} className="hidden" onChange={e => void captureFile(kind,e.target.files?.[0])} />
                  <button onClick={() => fileRefs.current[kind]?.click()} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border font-bold"><Upload className="h-4 w-4"/>Capture / upload</button>
                </div>
              ))}
              <div className="rounded-2xl border p-4">
                <div className="flex items-center justify-between gap-3"><div><p className="font-bold">{labels.liveness_video}</p><p className="text-xs text-muted-foreground">{uploaded.liveness_video ? 'Captured and uploaded' : 'Five-second live camera capture'}</p></div>{uploaded.liveness_video ? <CheckCircle2 className="h-5 w-5 text-emerald-600"/> : <Video className="h-5 w-5 text-primary"/>}</div>
                <button disabled={recording} onClick={() => void startLiveness()} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border font-bold disabled:opacity-50">{recording ? <><Loader2 className="h-4 w-4 animate-spin"/>Recording…</> : <><Video className="h-4 w-4"/>Record liveness</>}</button>
              </div>
              <button disabled={processing || requiredMissing(uploaded)} onClick={() => void beginProcessing()} className="flex h-13 w-full items-center justify-center rounded-2xl bg-primary px-4 font-black text-primary-foreground disabled:opacity-50">{processing ? <Loader2 className="h-5 w-5 animate-spin"/> : 'Submit for Testagram verification'}</button>
            </div>
          )}

          {approved && !user && (
            <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" /><h2 className="mt-3 text-xl font-black">Identity verified — finish creating your account</h2>
              <p className="mt-1 text-sm text-muted-foreground">Your identity passed Testagram's verification engine. Choose a password to create your account.</p>
              <div className="mt-5 space-y-3">
                <div className="relative"><KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password (8+ characters)" className="h-12 w-full rounded-2xl border bg-background pl-11 pr-4"/></div>
                <div className="relative"><KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><input type="password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="Confirm password" className="h-12 w-full rounded-2xl border bg-background pl-11 pr-4"/></div>
                <button disabled={finalizing} onClick={finalize} className="flex h-13 w-full items-center justify-center rounded-2xl bg-primary px-4 font-black text-primary-foreground disabled:opacity-50">{finalizing ? <Loader2 className="h-5 w-5 animate-spin"/> : 'Create my Testagram account'}</button>
              </div>
            </div>
          )}

          {user && approved && <button onClick={()=>navigate('/',{replace:true})} className="mt-6 flex h-13 w-full items-center justify-center rounded-2xl bg-primary px-4 font-black text-primary-foreground">Continue to Testagram</button>}
          {message && <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-700">{message}</p>}
          <div className="mt-6 border-t pt-5 text-xs leading-5 text-muted-foreground">
            <p><strong>Privacy by design:</strong> the evidence bucket is private and the engine receives only what it needs to produce a decision. Testagram stores the decision and a protected national-ID uniqueness fingerprint rather than retaining raw document images indefinitely.</p>
            <p className="mt-2">The verification engine is a server-side trust boundary. A modified browser cannot mark an identity approved.</p>
          </div>
        </div>
      </div>
    </main>
  );
}

function requiredMissing(uploaded: Partial<Record<EvidenceKind, boolean>>) {
  return (['id_front','id_back','selfie','liveness_video'] as EvidenceKind[]).some(k => !uploaded[k]);
}
