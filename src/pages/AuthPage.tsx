import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Mail, ShieldCheck, Smartphone, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { authService, finalizeAuthenticatedSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useSEO } from '@/hooks/useSEO';
import { useAuthStore } from '@/stores/authStore';
import { LegalAcceptanceGate, readLegalConsent } from '@/components/auth/LegalAcceptanceGate';

type AuthMode = 'signin' | 'signup' | 'verify' | 'verify-phone' | 'recover' | 'reset';
type AuthMethod = 'email' | 'phone';

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <img src="/app-icon.jpg" alt="Testagram" className="h-11 w-11 rounded-2xl object-cover shadow-sm" />
      <div><div className="text-lg font-black tracking-tight">Testagram</div><div className="text-[11px] text-muted-foreground">Connect. Create. Discover.</div></div>
    </div>
  );
}

function Field({ icon: Icon, ...props }: React.ComponentProps<typeof Input> & { icon: React.ComponentType<{ className?: string }> }) {
  return <div className="relative"><Icon className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input {...props} className={'h-13 rounded-2xl border-border/70 bg-background/80 pl-11 pr-4 shadow-sm transition focus-visible:ring-2 focus-visible:ring-primary/30 ' + (props.className || '')} /></div>;
}

export default function AuthPage() {
  useSEO({ noindex: true, title: 'Sign in · Testagram', url: '/auth' });
  const [mode, setMode] = useState<AuthMode>('signin');
  const [method, setMethod] = useState<AuthMethod>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifiedPhone, setVerifiedPhone] = useState('');
  const [verificationPurpose, setVerificationPurpose] = useState<'otp' | 'signup'>('otp');
  const [pendingReferralSignup, setPendingReferralSignup] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(() => !!readLegalConsent());
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const authUser = useAuthStore((state) => state.user);
  const login = useAuthStore((state) => state.login);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') === '1') setMode('reset');
    const ref = params.get('ref')?.trim();
    if (ref) window.localStorage.setItem('testagram-referral-code', ref);
  }, []);

  useEffect(() => {
    if (authUser && !['verify', 'verify-phone', 'reset'].includes(mode)) navigate('/', { replace: true });
  }, [authUser, mode, navigate]);

  const applyPendingReferral = async () => {
    const code = window.localStorage.getItem('testagram-referral-code');
    if (!code) return;
    try {
      const { error } = await supabase.rpc('apply_referral_code', { p_code: code });
      if (error && !error.message.includes('REFERRAL_ALREADY_APPLIED')) throw error;
      await supabase.rpc('complete_referral');
      window.localStorage.removeItem('testagram-referral-code');
    } catch { /* Referral rewards never block authentication. */ }
  };

  const finishLogin = async (user: any) => {
    const finalized = await finalizeAuthenticatedSession(user);
    login(finalized);
    setLoading(false);
    navigate('/', { replace: true });
  };

  const handlePasswordSignIn = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true);
    try { await finishLogin(await authService.signInWithPassword(email, password)); }
    catch (error: any) { setLoading(false); toast({ title: 'Sign-in failed', description: error?.message || 'Check your details and try again.', variant: 'destructive' }); }
  };

  const handlePasswordSignUp = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8 || password !== confirmation) { toast({ title: 'Check your password', description: password !== confirmation ? 'Passwords do not match.' : 'Use at least 8 characters.', variant: 'destructive' }); return; }
    setLoading(true);
    try {
      const result = await authService.signUpWithPassword(email, password, username);
      if (result.session) { await finishLogin(result.session.user); await applyPendingReferral(); return; }
      setVerificationPurpose('signup'); setPendingReferralSignup(true); setOtp(''); setMode(result.identifierKind === 'phone' ? 'verify-phone' : 'verify');
      if (result.identifierKind === 'phone') { setPhone(result.identifier); setVerifiedPhone(result.identifier); }
      toast({ title: 'Account created', description: result.identifierKind === 'phone' ? 'Enter the 6-digit SMS code to finish.' : 'Enter the 6-digit email code to finish.' });
    } catch (error: any) { setLoading(false); toast({ title: 'Could not create account', description: error?.message || 'Please try again.', variant: 'destructive' }); }
    finally { setLoading(false); }
  };

  const sendEmailOtp = async (event?: FormEvent) => {
    event?.preventDefault(); setLoading(true);
    try { await authService.sendOtp(email); setOtp(''); setVerificationPurpose('otp'); setMode('verify'); toast({ title: 'Code sent', description: 'Check your inbox for your 6-digit Testagram code.' }); }
    catch (error: any) { toast({ title: 'Email OTP failed', description: error?.message || 'We could not send the code.', variant: 'destructive' }); }
    finally { setLoading(false); }
  };

  const sendPhoneOtp = async (event?: FormEvent) => {
    event?.preventDefault(); setLoading(true);
    try { const normalized = await authService.sendPhoneOtp(phone); setPhone(normalized); setVerifiedPhone(normalized); setOtp(''); setVerificationPurpose('otp'); setMode('verify-phone'); toast({ title: 'Code sent', description: 'Check your phone for the 6-digit code.' }); }
    catch (error: any) { toast({ title: 'SMS OTP failed', description: error?.message || 'We could not send the code.', variant: 'destructive' }); }
    finally { setLoading(false); }
  };

  const verifyEmail = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true);
    try { const user = await authService.verifyEmailOtp(email, otp); await finishLogin(user); if (pendingReferralSignup) await applyPendingReferral(); }
    catch (error: any) { setLoading(false); toast({ title: 'Invalid code', description: error?.message || 'That code is invalid or expired.', variant: 'destructive' }); }
  };

  const verifyPhone = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true);
    try { const user = await authService.verifyPhoneOtp(phone, otp); await finishLogin(user); if (pendingReferralSignup) await applyPendingReferral(); }
    catch (error: any) { setLoading(false); toast({ title: 'Invalid code', description: error?.message || 'That code is invalid or expired.', variant: 'destructive' }); }
  };

  const resend = async () => {
    setLoading(true);
    try {
      if (verificationPurpose === 'signup') {
        if (mode === 'verify-phone') await authService.resendSignupPhone(phone); else await authService.resendSignupEmail(email);
      } else if (mode === 'verify-phone') await authService.sendPhoneOtp(phone); else await authService.sendOtp(email);
      toast({ title: 'New code sent', description: 'A fresh verification code is on its way.' });
    } catch (error: any) { toast({ title: 'Could not resend', description: error?.message || 'Please wait a moment and try again.', variant: 'destructive' }); }
    finally { setLoading(false); }
  };

  const requestReset = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true);
    try { await authService.resetPassword(email); toast({ title: 'Check your email', description: 'If the account exists, we sent a secure password reset link.' }); }
    catch (error: any) { toast({ title: 'Reset request failed', description: error?.message || 'Please check the email and try again.', variant: 'destructive' }); }
    finally { setLoading(false); }
  };

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8 || password !== confirmation) { toast({ title: 'Check your new password', description: password !== confirmation ? 'Passwords do not match.' : 'Use at least 8 characters.', variant: 'destructive' }); return; }
    setLoading(true);
    try { const user = await authService.updatePassword(password); login(await finalizeAuthenticatedSession(user)); window.history.replaceState({}, document.title, '/auth'); navigate('/', { replace: true }); }
    catch (error: any) { toast({ title: 'Password update failed', description: error?.message || 'Your reset link may have expired. Request a new one.', variant: 'destructive' }); }
    finally { setLoading(false); }
  };

  if (!legalAccepted) return <div className="min-h-screen bg-gradient-to-b from-background via-background to-primary/5 p-4 flex items-center justify-center"><LegalAcceptanceGate onAccepted={() => setLegalAccepted(true)} /></div>;

  const go = (next: AuthMode) => { setLoading(false); setOtp(''); setPassword(''); setConfirmation(''); setMode(next); };
  const title = mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : mode === 'recover' ? 'Reset your password' : mode === 'reset' ? 'Choose a new password' : mode === 'verify-phone' ? 'Verify your phone' : 'Verify your email';
  const subtitle = mode === 'signin' ? 'Sign in to continue your Testagram journey.' : mode === 'signup' ? 'Join Testagram and start sharing what matters.' : mode === 'recover' ? 'We’ll send a secure reset link to your email.' : mode === 'reset' ? 'Your new password should be at least 8 characters.' : 'One quick security check and you’re in.';

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_hsl(var(--primary)/.13),_transparent_38%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted)/.35))] px-4 py-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[2rem] border border-border/60 bg-card/90 shadow-2xl shadow-primary/5 backdrop-blur-xl lg:grid-cols-[.9fr_1.1fr]">
          <section className="relative hidden min-h-[680px] overflow-hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -bottom-28 -left-24 h-80 w-80 rounded-full bg-black/10 blur-3xl" />
            <div className="relative"><BrandMark /></div>
            <div className="relative max-w-md">
              <div className="mb-5 inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold"><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Built for the Testagram community</div>
              <h1 className="text-5xl font-black leading-[1.03] tracking-[-.04em]">Your people.<br />Your stories.<br />Your space.</h1>
              <p className="mt-6 max-w-sm text-sm leading-6 text-primary-foreground/75">A modern home for conversations, live media, creators and the moments you want to keep moving.</p>
            </div>
            <div className="relative flex items-center gap-2 text-xs text-primary-foreground/70"><ShieldCheck className="h-4 w-4" /> Secure authentication · Adults 18+</div>
          </section>

          <section className="flex min-h-[680px] flex-col p-5 sm:p-8 lg:p-12">
            <div className="flex items-center justify-between lg:justify-end"><div className="lg:hidden"><BrandMark /></div>{mode !== 'signin' && <button onClick={() => go('signin')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>}</div>

            <div className="mx-auto my-auto w-full max-w-md">
              <div className="mb-8 mt-8 lg:mt-0"><p className="mb-2 text-xs font-black uppercase tracking-[.18em] text-primary">Testagram account</p><h2 className="text-3xl font-black tracking-tight sm:text-4xl">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{subtitle}</p></div>

              {(mode === 'signin' || mode === 'signup') && (
                <>
                  <div className="mb-6 grid grid-cols-2 rounded-2xl bg-muted p-1">
                    <button onClick={() => go('signin')} className={'rounded-xl py-2.5 text-sm font-bold transition ' + (mode === 'signin' ? 'bg-background shadow-sm' : 'text-muted-foreground')}>Log in</button>
                    <button onClick={() => go('signup')} className={'rounded-xl py-2.5 text-sm font-bold transition ' + (mode === 'signup' ? 'bg-background shadow-sm' : 'text-muted-foreground')}>Create account</button>
                  </div>

                  <form onSubmit={mode === 'signin' ? handlePasswordSignIn : handlePasswordSignUp} className="space-y-3.5">
                    {mode === 'signup' && <Field icon={Sparkles} type="text" autoComplete="username" placeholder="Username (optional)" value={username} onChange={e => setUsername(e.target.value)} />}
                    <Field icon={Mail} type="email" autoComplete="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} required />
                    <div className="relative"><Field icon={KeyRound} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="Password (8+ characters)" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} /><button type="button" aria-label="Toggle password visibility" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-xl p-2 text-muted-foreground hover:bg-muted">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
                    {mode === 'signup' && <div className="relative"><Field icon={KeyRound} type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" placeholder="Confirm password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required minLength={8} /><button type="button" aria-label="Toggle confirmation visibility" onClick={() => setShowConfirmation(v => !v)} className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-xl p-2 text-muted-foreground hover:bg-muted">{showConfirmation ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>}
                    <Button type="submit" disabled={loading} className="h-13 w-full rounded-2xl text-sm font-black shadow-lg shadow-primary/20">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : mode === 'signin' ? 'Log in' : 'Create account'}</Button>
                  </form>

                  {mode === 'signin' && <button onClick={() => go('recover')} className="mt-4 w-full text-center text-sm font-semibold text-muted-foreground hover:text-primary">Forgot your password?</button>}

                  <div className="my-6 flex items-center gap-3"><div className="h-px flex-1 bg-border" /><span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">or continue with</span><div className="h-px flex-1 bg-border" /></div>
                  <div className="grid grid-cols-2 rounded-2xl bg-muted p-1">
                    <button onClick={() => setMethod('email')} className={'flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold ' + (method === 'email' ? 'bg-background shadow-sm' : 'text-muted-foreground')}><Mail className="h-4 w-4" /> Email code</button>
                    <button onClick={() => setMethod('phone')} className={'flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold ' + (method === 'phone' ? 'bg-background shadow-sm' : 'text-muted-foreground')}><Smartphone className="h-4 w-4" /> SMS code</button>
                  </div>
                  {method === 'email' ? <form onSubmit={sendEmailOtp} className="mt-3.5 flex gap-2"><Field icon={Mail} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required className="flex-1" /><Button disabled={loading} type="submit" className="h-13 shrink-0 rounded-2xl px-5">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send code'}</Button></form> : <form onSubmit={sendPhoneOtp} className="mt-3.5 flex gap-2"><Field icon={Smartphone} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={phone} onChange={e => setPhone(e.target.value)} required className="flex-1" /><Button disabled={loading} type="submit" className="h-13 shrink-0 rounded-2xl px-5">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send code'}</Button></form>}
                </>
              )}

              {mode === 'recover' && <form onSubmit={requestReset} className="space-y-4"><div className="rounded-2xl border border-primary/15 bg-primary/5 p-4 text-sm leading-6 text-muted-foreground"><KeyRound className="mb-2 h-5 w-5 text-primary" />Enter the email linked to your Testagram account. We’ll send a secure, time-limited reset link.</div><Field icon={Mail} type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required /><Button disabled={loading} className="h-13 w-full rounded-2xl font-black">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send reset link'}</Button></form>}

              {mode === 'reset' && <form onSubmit={updatePassword} className="space-y-3.5"><div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-muted-foreground"><CheckCircle2 className="mb-2 h-5 w-5 text-emerald-600" />You’re using a valid recovery session. Choose a new password below.</div><Field icon={KeyRound} type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} /><Field icon={KeyRound} type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required minLength={8} /><Button disabled={loading} className="h-13 w-full rounded-2xl font-black">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Update password'}</Button></form>}

              {(mode === 'verify' || mode === 'verify-phone') && <form onSubmit={mode === 'verify' ? verifyEmail : verifyPhone} className="space-y-4"><div className="rounded-2xl border border-primary/15 bg-primary/5 p-5 text-center"><div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10"><CheckCircle2 className="h-6 w-6 text-primary" /></div><p className="text-sm leading-6 text-muted-foreground">Enter the 6-digit code sent to <strong className="text-foreground">{mode === 'verify' ? email : verifiedPhone || phone}</strong>.</p></div><Input autoFocus inputMode="numeric" autoComplete="one-time-code" aria-label="6-digit verification code" placeholder="000000" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} required minLength={6} maxLength={6} className="h-16 rounded-2xl text-center text-3xl font-black tracking-[.45em]" /><Button disabled={loading} className="h-13 w-full rounded-2xl font-black">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Verify and continue'}</Button><button type="button" onClick={resend} disabled={loading} className="w-full text-sm font-bold text-primary hover:underline">Resend code</button><button type="button" onClick={() => go('signin')} className="w-full text-sm text-muted-foreground hover:underline">Use a different account</button></form>}

              <div className="mt-8 flex items-center justify-center gap-2 text-center text-[11px] leading-5 text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Your account is protected by Supabase authentication.</div>
              <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">By continuing, you agree to the Terms, Privacy Policy and Community Guidelines. Testagram is for adults 18+.</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
