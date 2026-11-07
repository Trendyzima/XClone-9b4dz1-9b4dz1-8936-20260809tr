import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { ComponentProps, ComponentType } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { finalizeAuthenticatedSession } from '@/lib/auth';
import { appwriteAuth } from '@/services/appwriteAuth';
import type { Models } from 'appwrite';
import type { AuthUser } from '@/types/app-types';
import { useSEO } from '@/hooks/useSEO';
import { useAuthStore } from '@/stores/authStore';
import { LegalAcceptanceGate } from '@/components/auth/LegalAcceptanceGate';

type AuthMode = 'signin' | 'signup' | 'verify' | 'recover' | 'reset';

function friendlyAuthError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  const safeMessages: Record<string, string> = {
    AGE_RESTRICTION: 'You must be at least 18 years old to create a Testagram account.',
    EMAIL_NOT_VERIFIED: 'Verify your email address before signing in.',
    IDENTITY_VERIFICATION_REQUIRED: 'Identity verification is required before this account can be activated. New registration is temporarily paused while that flow is migrated to Appwrite and Backend.',
    APPWRITE_RECOVERY_CONTEXT_REQUIRED: 'Open the newest password recovery link from your email before choosing a new password.',
    LEGAL_ACCEPTANCE_REQUIRED: 'Please review and accept the required policies before continuing.',
    RATE_LIMITED: 'Too many attempts. Wait a little before trying again.',
  };
  return safeMessages[message] || (message.toLowerCase().includes('timed out') ? 'The request took too long. Check your connection and try again.' : fallback);
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
    if (params.get('reset') === '1') return 'reset';
    if (params.get('verify') === '1') return 'verify';
    if (params.get('identity') === 'required') return 'signup';
    return 'signin';
  });
  const [email, setEmail] = useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('email') || '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [legalPendingUser, setLegalPendingUser] = useState<Models.User<Models.Preferences> | null>(null);
  const [recoveryChecking, setRecoveryChecking] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const authUser = useAuthStore((state) => state.user);
  const login = useAuthStore((state) => state.login);

  const finishLogin = useCallback(async (user: Models.User<Models.Preferences>, requireFreshLegalConsent = false) => {
    if (!user.emailVerification) {
      setEmail(user.email || '');
      setMode('verify');
      setLoading(false);
      return;
    }
    let finalized: AuthUser;
    try {
      finalized = await finalizeAuthenticatedSession(user, { requireFreshLegalConsent });
    } catch (error) {
      if (error instanceof Error && error.message === 'IDENTITY_VERIFICATION_REQUIRED') {
        try { await appwriteAuth.signOut(); } catch { /* best-effort cleanup */ }
        setLegalPendingUser(null);
        setMode('signin');
      }
      if (error instanceof Error && error.message === 'LEGAL_ACCEPTANCE_REQUIRED') {
        setLegalPendingUser(user);
        setLoading(false);
        return;
      }
      throw error;
    }
    setLegalPendingUser(null);
    login(finalized);
    setLoading(false);
    navigate(getSafeReturnTo(), { replace: true });
  }, [login, navigate]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId')?.trim() || '';
    const secret = params.get('secret')?.trim() || '';

    if (params.get('reset') === '1') {
      setMode('reset');
      setRecoveryChecking(Boolean(userId && secret));
      if (userId && secret) {
        appwriteAuth.saveRecoveryContext({ userId, secret, email: '' });
        setRecoveryReady(true);
        setRecoveryChecking(false);
        window.history.replaceState({}, document.title, '/auth?reset=1');
      } else {
        setRecoveryReady(Boolean(appwriteAuth.getRecoveryContext()));
        setRecoveryChecking(false);
      }
    }

    if (params.get('verify') === '1' && userId && secret) {
      setLoading(true);
      void (async () => {
        try {
          await appwriteAuth.completeEmailVerification(userId, secret);
          const user = await appwriteAuth.getCurrentUser();
          if (cancelled) return;
          window.history.replaceState({}, document.title, '/auth');
          if (user) await finishLogin(user);
          else {
            setMode('signin');
            setLoading(false);
            toast({ title: 'Email verified', description: 'Your email is verified. Sign in to continue.' });
          }
        } catch (error) {
          if (!cancelled) {
            setLoading(false);
            setMode('verify');
            toast({ title: 'Email verification failed', description: friendlyAuthError(error, 'The verification link is invalid or expired. Request a new one.'), variant: 'destructive' });
          }
        }
      })();
    }

    return () => { cancelled = true; };
  }, [finishLogin, login, navigate, toast]);

  useEffect(() => {
    if (authUser && !['verify', 'reset'].includes(mode)) navigate(getSafeReturnTo(), { replace: true });
  }, [authUser, mode, navigate]);

  const handlePasswordSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const user = await appwriteAuth.signInWithPassword({ email, password });
      if (!user.emailVerification) {
        await appwriteAuth.sendEmailVerification();
        setMode('verify');
        toast({ title: 'Verify your email', description: 'We sent a fresh verification link to your email address.' });
        setLoading(false);
        return;
      }
      await finishLogin(user);
    } catch (error) {
      setLoading(false);
      toast({ title: 'Sign-in failed', description: friendlyAuthError(error, 'Check your email and password, then try again.'), variant: 'destructive' });
    }
  };


  const resendVerification = async () => {
    setLoading(true);
    try {
      await appwriteAuth.sendEmailVerification();
      toast({ title: 'Verification link sent', description: 'Check your inbox and spam folder for the latest Testagram verification email.' });
    } catch (error) {
      toast({ title: 'Could not send verification link', description: friendlyAuthError(error, 'Please sign in again and request a new verification link.'), variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const requestReset = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await appwriteAuth.requestPasswordRecovery(email);
      toast({ title: 'Check your email', description: 'If the account exists, Appwrite has sent a secure password recovery link.' });
    } catch (error) {
      toast({ title: 'Reset request failed', description: friendlyAuthError(error, 'Please check the email and try again.'), variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    const recovery = appwriteAuth.getRecoveryContext();
    if (!recovery) {
      toast({ title: 'Recovery link required', description: 'Open the newest password recovery link from your email before choosing a new password.', variant: 'destructive' });
      return;
    }
    if (password.length < 8 || password !== confirmation) {
      toast({ title: 'Check your new password', description: password !== confirmation ? 'Passwords do not match.' : 'Use at least 8 characters.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      await appwriteAuth.completePasswordRecovery({ userId: recovery.userId, secret: recovery.secret, password });
      appwriteAuth.clearRecoveryContext();
      setRecoveryReady(false);
      setPassword('');
      setConfirmation('');
      setMode('signin');
      window.history.replaceState({}, document.title, '/auth');
      toast({ title: 'Password updated', description: 'Your password has been changed. Sign in with your new password.' });
    } catch (error) {
      toast({ title: 'Password update failed', description: friendlyAuthError(error, 'Your reset link may have expired. Request a new one.'), variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const go = (next: AuthMode) => {
    setLoading(false);
    setPassword('');
    setConfirmation('');
    if (mode === 'reset' && next !== 'reset') {
      appwriteAuth.clearRecoveryContext();
      setRecoveryReady(false);
      setRecoveryChecking(false);
      window.history.replaceState({}, document.title, '/auth');
    }
    setMode(next);
  };

  const title = mode === 'signin' ? 'Welcome back'
    : mode === 'signup' ? 'Registration is moving to Appwrite'
    : mode === 'verify' ? 'Verify your Appwrite email'
    : mode === 'recover' ? 'Reset your password'
    : 'Choose a new password';
  const subtitle = mode === 'signin' ? 'Sign in securely with your Testagram account.'
     : mode === 'signup' ? 'Verify your email and identity before your Appwrite account is created.'
    : mode === 'verify' ? 'Open the secure Appwrite verification link sent to ' + (email || 'your email address') + '.'
    : mode === 'recover' ? 'We’ll send a secure, time-limited recovery link to your email.'
    : 'Choose a new password for your Testagram account.';

  if (legalPendingUser) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
        <LegalAcceptanceGate onAccepted={() => {
          setLoading(true);
          void finishLogin(legalPendingUser, true).catch(error => {
            setLoading(false);
            toast({
              title: 'Could not complete sign-in',
              description: friendlyAuthError(error, 'Your consent could not be saved. Please retry.'),
              variant: 'destructive',
            });
          });
        }} />
      </main>
    );
  }

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
            <div className="relative flex items-center gap-2 text-xs text-primary-foreground/70"><ShieldCheck className="h-4 w-4" /> Appwrite identity · Private Backend API · Adults 18+</div>
          </section>

          <section className="flex min-h-[680px] flex-col p-5 sm:p-8 lg:p-12">
            <div className="flex items-center justify-between lg:justify-end">
              <div className="lg:hidden"><BrandMark /></div>
              {mode !== 'signin' && <button onClick={() => go('signin')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to login</button>}
            </div>

            <div className="mx-auto my-auto w-full max-w-md">
              <div className="mb-8 mt-8 lg:mt-0"><p className="mb-2 text-xs font-black uppercase tracking-[.18em] text-primary">Testagram account</p><h2 className="text-3xl font-black tracking-tight sm:text-4xl">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{subtitle}</p></div>

              {(mode === 'signin' || mode === 'signup') && (
                <>
                  <div className="mb-6 grid grid-cols-2 rounded-2xl bg-muted p-1">
                    <button type="button" onClick={() => go('signin')} className={'rounded-xl py-2.5 text-sm font-bold transition ' + (mode === 'signin' ? 'bg-background shadow-sm' : 'text-muted-foreground')}>Log in</button>
                    <button type="button" onClick={() => go('signup')} className={'rounded-xl py-2.5 text-sm font-bold transition ' + (mode === 'signup' ? 'bg-background shadow-sm' : 'text-muted-foreground')}>Create account</button>
                  </div>
                  {mode === 'signin' ? (
                    <>
                      <form onSubmit={handlePasswordSignIn} className="space-y-3.5">
                        <Field icon={Mail} type="email" autoComplete="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} required />
                        <div className="relative">
                          <Field icon={KeyRound} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
                          <button type="button" aria-label="Toggle password visibility" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-xl p-2 text-muted-foreground hover:bg-muted">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                        </div>
                        <Button type="submit" disabled={loading} className="h-13 w-full rounded-2xl text-sm font-black shadow-lg shadow-primary/20">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Log in securely'}</Button>
                      </form>
                      <button type="button" onClick={() => go('recover')} className="mt-4 w-full text-center text-sm font-semibold text-muted-foreground hover:text-primary">Forgot your password?</button>
                    </>
                  ) : (
                    <div className="space-y-4 rounded-3xl border border-amber-500/20 bg-amber-500/5 p-5">
                      <div className="flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5 text-amber-600" /> Registration temporarily paused</div>
                      <p className="text-sm leading-6 text-muted-foreground">Identity approval and evidence upload must be completed by the Backend before an account can be provisioned. New accounts remain paused until that secure flow is complete. Existing approved Appwrite accounts can still sign in.</p>
                      <Button type="button" variant="outline" onClick={() => go('signin')} className="w-full rounded-2xl">Back to sign in</Button>
                    </div>
                  )}
                </>
              )}

              {mode === 'verify' && (
                <div className="space-y-4">
                  <div className="rounded-3xl border border-primary/15 bg-primary/5 p-6 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10"><Mail className="h-7 w-7 text-primary" /></div>
                    <p className="text-sm text-muted-foreground">Verification email sent to</p>
                    <p className="mt-1 break-all font-bold">{email || 'your email address'}</p>
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">Open the link in the latest Testagram email to verify your account. This page will complete verification and continue setup.</p>
                  </div>
                  <Button disabled={loading} onClick={resendVerification} className="h-13 w-full rounded-2xl font-black">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Resend verification link'}</Button>
                  <button type="button" onClick={() => go('signin')} className="w-full text-center text-sm font-semibold text-muted-foreground hover:text-foreground">Return to login</button>
                </div>
              )}

              {mode === 'recover' && (
                <form onSubmit={requestReset} className="space-y-4">
                  <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4 text-sm leading-6 text-muted-foreground"><KeyRound className="mb-2 h-5 w-5 text-primary" />Enter the email linked to your Testagram account. Appwrite will send a secure recovery link.</div>
                  <Field icon={Mail} type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
                  <Button disabled={loading} className="h-13 w-full rounded-2xl font-black">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send recovery link'}</Button>
                </form>
              )}

              {mode === 'reset' && (recoveryReady ? (
                <form onSubmit={updatePassword} className="space-y-3.5">
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-muted-foreground"><CheckCircle2 className="mb-2 h-5 w-5 text-emerald-600" />Recovery link received. Choose a new password to complete the reset.</div>
                  <Field icon={KeyRound} type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
                  <Field icon={KeyRound} type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required minLength={8} />
                  <Button disabled={loading} className="h-13 w-full rounded-2xl font-black">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Update password'}</Button>
                </form>
              ) : (
                <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-5 text-sm text-muted-foreground">
                  {recoveryChecking ? <><Loader2 className="mb-2 h-5 w-5 animate-spin" />Verifying your password recovery link…</> : <>This recovery link is invalid, expired, or already used. Request a new link and open the latest email.</>}
                  <Button type="button" variant="outline" className="w-full rounded-2xl" onClick={() => go('recover')}>Request a new recovery link</Button>
                </div>
              ))}

              <div className="mt-8 flex items-center justify-center gap-2 text-center text-[11px] leading-5 text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Identity secured by Appwrite. Permissions and product data are enforced by Testagram Backend.</div>
              <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">By continuing, you agree to the Terms, Privacy Policy and Community Guidelines. Testagram is for adults 18+.</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
