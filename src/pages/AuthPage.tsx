import { FormEvent, useEffect, useState } from 'react';
import type { ComponentProps, ComponentType } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { authService, finalizeAuthenticatedSession } from '@/lib/auth';
import { initialAuthCallbackSearch, supabase } from '@/lib/supabase';
import { useSEO } from '@/hooks/useSEO';
import { useAuthStore } from '@/stores/authStore';
import { LegalAcceptanceGate, readLegalConsent } from '@/components/auth/LegalAcceptanceGate';
import { identitySignup } from '@/lib/identitySignup';

type AuthMode = 'signin' | 'signup' | 'otp' | 'recover' | 'reset';

function friendlyAuthError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  const safeMessages: Record<string, string> = {
    AGE_RESTRICTION: 'You must be at least 18 years old to create a Testagram account.',
    LEGAL_ACCEPTANCE_REQUIRED: 'Please review and accept the required policies before continuing.',
    INVALID_EMAIL: 'Enter a valid email address.',
    EMAIL_ALREADY_REGISTERED: 'An account may already exist for this email. Try signing in or recovering your password.',
    REGISTRATION_EXPIRED: 'This registration has expired. Start again to receive a new verification code.',
    REGISTRATION_TOKEN_REQUIRED: 'Your registration session has expired. Start again to continue.',
    REGISTRATION_COMPLETED: 'This registration has already been completed. Please sign in.',
    PASSWORD_TOO_SHORT: 'Use a password with at least 8 characters.',
    EMAIL_NOT_VERIFIED: 'Verify your email before continuing.',
    IDENTITY_NOT_APPROVED: 'Your identity must be approved before creating the account.',
    IDENTITY_SERVICE_UNAVAILABLE: 'Authentication services are temporarily unavailable. Please try again shortly.',
    IDENTITY_REQUEST_TIMEOUT: 'The request took too long. Check your connection and try again.',
    IDENTITY_NETWORK_ERROR: 'Could not reach the authentication service. Check your connection and try again.',
    RATE_LIMITED: 'Too many attempts. Wait a little before trying again.',
    TESTAGRAM_MAIL_NOT_CONFIGURED: 'Email verification is temporarily unavailable. Please try again later.',
  };
  return safeMessages[message] || (message.includes('timed out') ? 'The request took too long. Check your connection and try again.' : fallback);
}

function getSafeReturnTo() {
  if (typeof window === 'undefined') return '/';
  const value = new URLSearchParams(window.location.search).get('returnTo')?.trim();
  return value && value.startsWith('/iptv-app/') ? value : '/';
}

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <img src="/app-icon.jpg" alt="Testagram" className="h-11 w-11 rounded-2xl object-cover shadow-sm" />
      <div><div className="text-lg font-black tracking-tight">Testagram</div><div className="text-[11px] text-muted-foreground">Connect. Create. Discover.</div></div>
    </div>
  );
}

function Field({ icon: Icon, ...props }: ComponentProps<typeof Input> & { icon: ComponentType<{ className?: string }> }) {
  return <div className="relative"><Icon className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input {...props} className={'h-13 rounded-2xl border-border/70 bg-background/80 pl-11 pr-4 shadow-sm transition focus-visible:ring-2 focus-visible:ring-primary/30 ' + (props.className || '')} /></div>;
}

export default function AuthPage() {
  useSEO({ noindex: true, title: 'Sign in · Testagram', url: '/auth' });
  const [mode, setMode] = useState<AuthMode>(() => {
    if (typeof window === 'undefined') return 'signin';
    const params = new URLSearchParams(window.location.search);
    return params.get('reset') === '1' || params.get('type') === 'recovery' ? 'reset' : 'signin';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [otp, setOtp] = useState('');
  const [otpPurpose, setOtpPurpose] = useState<'signin' | 'signup'>('signin');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const authUser = useAuthStore((state) => state.user);
  const login = useAuthStore((state) => state.login);
  const [legalAccepted, setLegalAccepted] = useState(() => !!readLegalConsent());
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryChecking, setRecoveryChecking] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isResetRoute = params.get('reset') === '1';
    const initialCallbackParams = new URLSearchParams(initialAuthCallbackSearch);
    const hasPkceCode = params.has('code') || (isResetRoute && initialCallbackParams.has('code'));
    if (isResetRoute) {
      setMode('reset');
      setRecoveryChecking(true);
    }
    const ref = params.get('ref')?.trim();
    if (ref) window.localStorage.setItem('testagram-referral-code', ref);

    let cancelled = false;
    // PKCE recovery links are exchanged by Supabase's URL detector. Only the
    // recovery event is allowed to unlock the password-reset form.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const recoveryCallbackEvent =
        event === 'PASSWORD_RECOVERY' ||
        (isResetRoute && hasPkceCode && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION'));
      if (recoveryCallbackEvent && session?.user) {
        setMode('reset');
        setRecoveryReady(true);
        setRecoveryChecking(false);
        setLoading(false);
        try { window.sessionStorage.setItem('testagram-password-recovery', session.user.id); } catch {}
        window.history.replaceState({}, document.title, '/auth?reset=1');
      }
    });

    // Supabase may finish exchanging the PKCE code before this component mounts.
    if (isResetRoute && hasPkceCode) {
      void supabase.auth.getSession().then(({ data, error }) => {
        if (cancelled || error || !data.session?.user) return;
        setRecoveryReady(true);
        setRecoveryChecking(false);
        try { window.sessionStorage.setItem('testagram-password-recovery', data.session.user.id); } catch {}
        window.history.replaceState({}, document.title, '/auth?reset=1');
      });
    }

    const tokenHash = params.get('token_hash')?.trim();
    const requestedTokenType = params.get('type')?.trim();
    const allowedTokenTypes = new Set(['email', 'signup', 'magiclink', 'recovery', 'invite', 'email_change']);
    if (!tokenHash || !requestedTokenType || !allowedTokenTypes.has(requestedTokenType)) {
      if (isResetRoute && !hasPkceCode) {
        void supabase.auth.getSession().then(({ data, error }) => {
          if (cancelled) return;
          if (error || !data.session?.user) {
            setRecoveryChecking(false);
            return;
          }
          let marker: string | null = null;
          try { marker = window.sessionStorage.getItem('testagram-password-recovery'); } catch {}
          if (marker === data.session.user.id) setRecoveryReady(true);
          setRecoveryChecking(false);
        });
      }
      return () => { cancelled = true; subscription.unsubscribe(); };
    }
    const tokenType = requestedTokenType as 'email' | 'signup' | 'magiclink' | 'recovery' | 'invite' | 'email_change';

    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tokenType });
        if (error) throw error;
        if (!data.user) throw new Error('Verification succeeded but no user session was returned');
        if (cancelled) return;
        if (tokenType === 'recovery') {
          // Recovery is not a sign-in. Do not finalize/login/navigate until the
          // user explicitly submits a new password.
          setMode('reset');
          setRecoveryReady(true);
          setRecoveryChecking(false);
          setLoading(false);
          try { window.sessionStorage.setItem('testagram-password-recovery', data.user.id); } catch {}
          window.history.replaceState({}, document.title, '/auth?reset=1');
          return;
        }
        window.history.replaceState({}, document.title, '/auth');
        await finishLogin(data.user);
      } catch (error: any) {
        if (!cancelled) {
          setLoading(false);
          setRecoveryChecking(false);
          setRecoveryReady(false);
          toast({ title: 'Verification link failed', description: friendlyAuthError(error, 'Request a new verification email.'), variant: 'destructive' });
        }
      }
    })();
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (authUser && !['otp', 'reset'].includes(mode)) navigate(getSafeReturnTo(), { replace: true });
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
    await applyPendingReferral();
    // Existing-account login never launches KYC. Identity verification is only
    // entered from the explicit account-creation flow.
    navigate(getSafeReturnTo(), { replace: true });
  };

  const handlePasswordSignIn = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true);
    try { await finishLogin(await authService.signInWithPassword(email, password)); }
    catch (error: any) { setLoading(false); toast({ title: 'Sign-in failed', description: friendlyAuthError(error, 'Check your details and try again.'), variant: 'destructive' }); }
  };

  const startIdentitySignup = async () => {
    const consent = readLegalConsent();
    if (!consent?.birthDate) {
      setLegalAccepted(false);
      throw new Error('LEGAL_ACCEPTANCE_REQUIRED');
    }
    await identitySignup.start({
      email,
      birthDate: consent.birthDate,
      username,
      legalPolicyVersion: consent.version,
    });
    setOtpPurpose('signup');
    setOtp('');
    setMode('otp');
    toast({ title: 'Email verification required', description: 'We sent a 6-digit code. Your Testagram account is not created yet.' });
  };

  const handlePasswordSignUp = async (event: FormEvent) => {
    event.preventDefault();
    // Password creation happens only after email and identity verification have
    // succeeded. Do not collect a password here that cannot yet be used.
    setLoading(true);
    try {
      await startIdentitySignup();
    } catch (error: any) {
      toast({ title: 'Could not start identity verification', description: friendlyAuthError(error, 'Please try again.'), variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const sendEmailOtp = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true);
    try {
      if (mode === 'signup') {
        await startIdentitySignup();
      } else {
        await authService.sendEmailOtp(email, false);
        setOtpPurpose('signin');
        setOtp('');
        setMode('otp');
        toast({ title: 'Verification code sent', description: 'Enter the 6-digit code we sent to your email.' });
      }
    } catch (error: any) {
      toast({ title: 'Code request failed', description: friendlyAuthError(error, 'We could not send the verification code.'), variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const verifyEmailOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp.trim())) {
      toast({ title: 'Invalid code', description: 'Enter the 6-digit verification code from your email.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      if (otpPurpose === 'signup') {
        await identitySignup.verifyEmail(otp);
        setLoading(false);
        navigate('/verify-identity', { replace: true });
        return;
      }
      await finishLogin(await authService.verifyEmailOtp(email, otp, 'email'));
    } catch (error: any) {
      setLoading(false);
      toast({ title: 'Verification failed', description: friendlyAuthError(error, 'The code is invalid or expired.'), variant: 'destructive' });
    }
  };

  const resendEmailOtp = async () => {
    setLoading(true);
    try {
      if (otpPurpose === 'signup') {
        await identitySignup.resendEmail();
      } else {
        await authService.sendEmailOtp(email, false);
      }
      setOtp('');
      toast({ title: 'New code sent', description: 'Check your email for the latest 6-digit verification code.' });
    } catch (error: any) {
      toast({ title: 'Could not resend code', description: friendlyAuthError(error, 'Please try again.'), variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const requestReset = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true);
    try {
      await authService.resetPassword(email);
      toast({ title: 'Check your email', description: 'If the account exists, we sent a secure password reset link.' });
    } catch (error: any) {
      toast({ title: 'Reset request failed', description: friendlyAuthError(error, 'Please check the email and try again.'), variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!recoveryReady) {
      toast({ title: 'Recovery link required', description: 'Open the latest password-reset link from your email before choosing a new password.', variant: 'destructive' });
      return;
    }
    if (password.length < 8 || password !== confirmation) {
      toast({ title: 'Check your new password', description: password !== confirmation ? 'Passwords do not match.' : 'Use at least 8 characters.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const user = await authService.updatePassword(password);
      const finalized = await finalizeAuthenticatedSession(user);
      try { window.sessionStorage.removeItem('testagram-password-recovery'); } catch {}
      setRecoveryReady(false);
      login(finalized);
      window.history.replaceState({}, document.title, '/auth');
      navigate(getSafeReturnTo(), { replace: true });
    } catch (error: any) {
      toast({ title: 'Password update failed', description: friendlyAuthError(error, 'Your reset link may have expired. Request a new one.'), variant: 'destructive' });
    } finally { setLoading(false); }
  };

  // Age/legal confirmation is an account-creation gate, not a login gate. Existing
  // accounts must be able to sign in without seeing the page again. The durable
  // server-side consent fields are written during account creation; localStorage is
  // only a pre-account convenience and never the authorization source.
  if (mode === 'signup' && !legalAccepted) return <div className="min-h-screen bg-gradient-to-b from-background via-background to-primary/5 p-4 flex items-center justify-center"><LegalAcceptanceGate onAccepted={() => setLegalAccepted(true)} /></div>;

  const go = (next: AuthMode) => {
    setLoading(false);
    setPassword('');
    setConfirmation('');
    if (mode === 'reset' && next !== 'reset') {
      // Leaving the reset screen cancels its temporary session and removes the
      // reset marker from the URL so refresh cannot reopen a stale reset flow.
      let hasRecoveryMarker = false;
      try {
        hasRecoveryMarker = !!window.sessionStorage.getItem('testagram-password-recovery');
        window.sessionStorage.removeItem('testagram-password-recovery');
      } catch {}
      if (recoveryReady || hasRecoveryMarker) void supabase.auth.signOut();
      setRecoveryReady(false);
      setRecoveryChecking(false);
      window.history.replaceState({}, document.title, '/auth');
    }
    setMode(next);
  };
  const title = mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : mode === 'otp' ? 'Enter your verification code' : mode === 'recover' ? 'Reset your password' : 'Choose a new password';
  const subtitle = mode === 'signin' ? 'Sign in to continue your Testagram journey.' : mode === 'signup' ? 'Verify your email and identity first. You will create your password after approval.' : mode === 'otp' ? `We sent a 6-digit code to ${email}. Enter it below to continue.` : mode === 'recover' ? 'We’ll send a secure reset link to your email.' : 'Your new password should be at least 8 characters.';

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
            <div className="flex items-center justify-between lg:justify-end"><div className="lg:hidden"><BrandMark /></div>{!['signin'].includes(mode) && <button onClick={() => go('signin')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>}</div>

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
                    {mode === 'signin' && <div className="relative"><Field icon={KeyRound} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} /><button type="button" aria-label="Toggle password visibility" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-xl p-2 text-muted-foreground hover:bg-muted">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>}
                    <Button type="submit" disabled={loading} className="h-13 w-full rounded-2xl text-sm font-black shadow-lg shadow-primary/20">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : mode === 'signin' ? 'Log in with password' : 'Continue to email verification'}</Button>
                  </form>

                  {mode === 'signin' && <button onClick={() => go('recover')} className="mt-4 w-full text-center text-sm font-semibold text-muted-foreground hover:text-primary">Forgot your password?</button>}

                  <div className="my-6 flex items-center gap-3"><div className="h-px flex-1 bg-border" /><span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">or use email code</span><div className="h-px flex-1 bg-border" /></div>
                  <form onSubmit={sendEmailOtp} className="space-y-3.5">
                    <Field icon={Mail} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
                    <Button disabled={loading} type="submit" variant="outline" className="h-13 w-full rounded-2xl font-black">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Email me a verification code'}</Button>
                  </form>
                </>
              )}

              {mode === 'otp' && <form onSubmit={verifyEmailOtp} className="space-y-4">
                <div className="rounded-3xl border border-primary/15 bg-primary/5 p-6 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10"><Mail className="h-7 w-7 text-primary" /></div>
                  <p className="text-sm text-muted-foreground">Verification code sent to</p>
                  <p className="mt-1 font-bold break-all">{email}</p>
                </div>
                <Field icon={KeyRound} type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit verification code" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} required maxLength={6} />
                <Button disabled={loading || otp.length !== 6} type="submit" className="h-13 w-full rounded-2xl font-black">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Verify code & continue'}</Button>
                <button type="button" onClick={resendEmailOtp} disabled={loading} className="w-full text-center text-sm font-semibold text-muted-foreground hover:text-primary disabled:opacity-50">Resend verification code</button>
                <button type="button" onClick={() => go('signin')} disabled={loading} className="w-full text-center text-sm font-semibold text-muted-foreground hover:text-foreground">Use another email</button>
              </form>}

              {mode === 'recover' && <form onSubmit={requestReset} className="space-y-4"><div className="rounded-2xl border border-primary/15 bg-primary/5 p-4 text-sm leading-6 text-muted-foreground"><KeyRound className="mb-2 h-5 w-5 text-primary" />Enter the email linked to your Testagram account. We’ll send a secure, time-limited reset link.</div><Field icon={Mail} type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required /><Button disabled={loading} className="h-13 w-full rounded-2xl font-black">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send reset link'}</Button></form>}

              {mode === 'reset' && (recoveryReady ? <form onSubmit={updatePassword} className="space-y-3.5"><div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-muted-foreground"><CheckCircle2 className="mb-2 h-5 w-5 text-emerald-600" />Recovery link verified. Choose a new password to complete the reset.</div><Field icon={KeyRound} type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} /><Field icon={KeyRound} type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required minLength={8} /><Button disabled={loading} className="h-13 w-full rounded-2xl font-black">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Update password'}</Button></form> : <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-5 text-sm text-muted-foreground">{recoveryChecking ? <><Loader2 className="mb-2 h-5 w-5 animate-spin" />Verifying your password-reset link…</> : <>This reset link is invalid, expired, or already used. Request a new password-reset email and open its newest link.</>}<Button type="button" variant="outline" className="w-full rounded-2xl" onClick={() => go('recover')}>Request a new reset link</Button></div>)}

              <div className="mt-8 flex items-center justify-center gap-2 text-center text-[11px] leading-5 text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Your account is protected by Supabase authentication.</div>
              <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">By continuing, you agree to the Terms, Privacy Policy and Community Guidelines. Testagram is for adults 18+.</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
