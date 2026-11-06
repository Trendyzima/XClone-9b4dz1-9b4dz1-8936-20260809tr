import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LegalAcceptanceGate, clearLegalConsent, readLegalConsent, LEGAL_POLICY_VERSION } from '@/components/auth/LegalAcceptanceGate';
import { appwriteAuth } from '@/services/appwriteAuth';
import { identitySignup } from '@/lib/identitySignup';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { AuthUser } from '@/types/app-types';

type Mode = 'signin' | 'signup' | 'otp' | 'migrate' | 'recover' | 'reset';
type SignupDraft = { email: string; username?: string; displayName?: string; legacyMigration?: boolean };
const SIGNUP_DRAFT_KEY = 'testagram-appwrite-signup-draft';

function mapIdentity(identity: Awaited<ReturnType<typeof appwriteAuth.getCanonicalIdentity>>): AuthUser {
  return { id: identity.canonical_user_id, email: identity.email, username: identity.username };
}

export default function AppwriteAuthPage() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [legacyPassword, setLegacyPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [otp, setOtp] = useState('');
  const [legalReady, setLegalReady] = useState(!!readLegalConsent());
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [linkRequired, setLinkRequired] = useState(false);
  const [recovery, setRecovery] = useState<{ userId: string; secret: string } | null>(null);

  const finishCanonicalLogin = async () => {
    const identity = await appwriteAuth.getCanonicalIdentity();
    login(mapIdentity(identity));
    navigate('/', { replace: true });
  };

  const readDraft = (): SignupDraft | null => {
    try {
      const raw = window.localStorage.getItem(SIGNUP_DRAFT_KEY);
      return raw ? JSON.parse(raw) as SignupDraft : null;
    } catch { return null; }
  };

  const completeLegacyLink = async () => {
    const legacy = await supabase.auth.getSession();
    if (!legacy.data.session?.access_token) throw new Error('Sign in to your existing Testagram account to prove ownership.');
    await appwriteAuth.linkLegacyAccount(legacy.data.session.access_token);
    await supabase.auth.signOut();
    window.localStorage.removeItem(SIGNUP_DRAFT_KEY);
    clearLegalConsent();
    setLinkRequired(false);
    await finishCanonicalLogin();
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId') || '';
    const secret = params.get('secret') || '';
    if (params.get('appwrite_recovery') === '1' && userId && secret) {
      setRecovery({ userId, secret });
      setMode('reset');
      window.history.replaceState({}, document.title, '/auth?appwrite_recovery=1');
      return;
    }
    if (params.get('appwrite_verify') === '1' && userId && secret) {
      setLoading(true);
      void (async () => {
        try {
          await appwriteAuth.completeEmailVerification(userId, secret);
          const draft = readDraft();
          if (draft?.legacyMigration) {
            try {
              await completeLegacyLink();
              return;
            } catch {
              setLinkRequired(true);
              setNotice('Your Appwrite email is verified. Sign in once with your existing Testagram credentials below to attach the new login to your original account.');
              return;
            }
          }
          const consent = readLegalConsent();
          if (!draft?.email || !draft.username || !draft.displayName || !consent?.birthDate) {
            setNotice('Your email is verified. Your approved identity registration is preserved; complete setup using the same browser or contact support.');
            setMode('signin');
            return;
          }
          await appwriteAuth.provisionCanonicalIdentity({
            username: draft.username,
            displayName: draft.displayName,
            birthDate: consent.birthDate,
            policyVersion: consent.version,
          });
          window.localStorage.removeItem(SIGNUP_DRAFT_KEY);
          clearLegalConsent();
          await finishCanonicalLogin();
        } catch (failure) {
          const issue = failure as { code?: string; message?: string };
          if (issue.code === 'LEGACY_ACCOUNT_REQUIRES_LINK') {
            setLinkRequired(true);
            setNotice(issue.message || 'This email belongs to an existing account. Link it using your existing account credentials.');
          } else if (issue.code === 'LEGACY_INVENTORY_INCOMPLETE') {
            setNotice('Your Appwrite email is verified and your KYC approval is preserved. New account creation is paused until the complete legacy account inventory has been reconciled. Do not create another account.');
            setMode('signin');
          } else {
            setError(issue.message || 'Email verification or account setup failed.');
          }
        } finally {
          setLoading(false);
          window.history.replaceState({}, document.title, '/auth');
        }
      })();
    }
  }, []);

  const submitSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true); setError(''); setNotice(''); setLinkRequired(false);
    try {
      const account = await appwriteAuth.signInWithPassword({ email, password });
      if (!account.emailVerification) {
        await appwriteAuth.sendEmailVerification();
        setNotice('Verify your email using the Appwrite link we just sent. Your existing account and KYC records remain unchanged.');
        return;
      }
      await finishCanonicalLogin();
    } catch (failure) {
      const issue = failure as { code?: string; message?: string };
      if (issue.code === 'IDENTITY_NOT_PROVISIONED' || issue.code === 'LEGACY_ACCOUNT_REQUIRES_LINK') {
        const draft = readDraft();
        if (draft?.email && draft.email.toLowerCase() === email.trim().toLowerCase()) {
          setNotice('Your Appwrite account exists, but Testagram account provisioning is still pending the verified migration gates. Do not create another account.');
        } else {
          setLinkRequired(true);
          setError('This Appwrite account is not linked to its canonical Testagram profile yet.');
        }
      } else {
        setError(issue.message || 'Sign-in failed. Check your details and try again.');
      }
    } finally { setLoading(false); }
  };

  const submitSignUp = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true); setError(''); setNotice('');
    try {
      const consent = readLegalConsent();
      if (!consent?.birthDate) throw new Error('Accept the current Testagram policies and confirm your date of birth first.');
      if (!/^[A-Za-z0-9_]{3,30}$/.test(username.trim())) throw new Error('Username must contain 3–30 letters, numbers or underscores.');
      if (!displayName.trim() || displayName.trim().length > 80) throw new Error('Enter a display name of up to 80 characters.');
      const normalizedEmail = email.trim().toLowerCase();
      window.localStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify({ email: normalizedEmail, username: username.trim(), displayName: displayName.trim() }));
      await identitySignup.start({ email: normalizedEmail, birthDate: consent.birthDate, username: username.trim(), displayName: displayName.trim(), legalPolicyVersion: LEGAL_POLICY_VERSION });
      setMode('otp');
      setNotice('We sent a one-time email code. Verify your email, then complete Testagram identity verification before your Appwrite account is created.');
    } catch (failure) {
      const issue = failure as { message?: string };
      setError(issue.message || 'Could not start secure account registration.');
    } finally { setLoading(false); }
  };

  const verifyRegistrationEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp.trim())) { setError('Enter the six-digit code sent to your email.'); return; }
    setLoading(true); setError('');
    try {
      await identitySignup.verifyEmail(otp.trim());
      navigate('/verify-identity', { replace: true });
    } catch (failure) {
      const issue = failure as { message?: string };
      setError(issue.message || 'Email verification failed. Request a new code.');
    } finally { setLoading(false); }
  };

  const resendRegistrationEmail = async () => {
    setLoading(true); setError('');
    try { await identitySignup.resendEmail(); setOtp(''); setNotice('A new verification code has been sent.'); }
    catch (failure) { const issue = failure as { message?: string }; setError(issue.message || 'Could not resend the verification code.'); }
    finally { setLoading(false); }
  };

  const submitExistingMigration = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8 || password !== confirmation) { setError('Use matching Appwrite passwords of at least 8 characters.'); return; }
    setLoading(true); setError(''); setNotice('');
    try {
      const legacy = await supabase.auth.signInWithPassword({ email, password: legacyPassword });
      if (legacy.error || !legacy.data.session?.access_token) throw new Error('The existing Testagram email or password could not be verified.');
      const normalizedEmail = email.trim().toLowerCase();
      try {
        await appwriteAuth.signUpWithPassword({ email: normalizedEmail, password, name: normalizedEmail.split('@')[0] });
      } catch {
        await appwriteAuth.signInWithPassword({ email: normalizedEmail, password });
      }
      window.localStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify({ email: normalizedEmail, legacyMigration: true }));
      const account = await appwriteAuth.getCurrentUser();
      if (account.emailVerification) {
        await completeLegacyLink();
      } else {
        await appwriteAuth.sendEmailVerification();
        setNotice('Your existing Testagram account is verified. We sent an Appwrite email-verification link. Open it on this device; then the two identities will be linked to your original Testagram user ID.');
        setMode('signin');
      }
    } catch (failure) {
      const issue = failure as { message?: string };
      setError(issue.message || 'Existing account migration could not be started.');
    } finally { setLoading(false); }
  };

  const submitLegacyLink = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true); setError(''); setNotice('');
    try {
      const legacy = await supabase.auth.signInWithPassword({ email, password: legacyPassword });
      if (legacy.error || !legacy.data.session?.access_token) throw new Error('The existing Testagram email or password could not be verified.');
      await appwriteAuth.linkLegacyAccount(legacy.data.session.access_token);
      await supabase.auth.signOut();
      window.localStorage.removeItem(SIGNUP_DRAFT_KEY);
      clearLegalConsent();
      setLinkRequired(false);
      setLegacyPassword('');
      await finishCanonicalLogin();
    } catch (failure) {
      const issue = failure as { message?: string };
      setError(issue.message || 'Existing account linking failed. No account data was changed.');
    } finally { setLoading(false); }
  };

  const submitRecovery = async (event: FormEvent) => {
    event.preventDefault();
    if (!recovery || password.length < 8 || password !== confirmation) {
      setError('Open a valid recovery link and enter matching passwords of at least 8 characters.');
      return;
    }
    setLoading(true); setError('');
    try {
      await appwriteAuth.completePasswordRecovery({ ...recovery, password });
      setRecovery(null); setPassword(''); setConfirmation('');
      setMode('signin');
      setNotice('Your password has been updated. Sign in with your new password.');
    } catch (failure) {
      const issue = failure as { message?: string };
      setError(issue.message || 'Password recovery failed. Request a new recovery link.');
    } finally { setLoading(false); }
  };

  const requestRecovery = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError(''); setNotice('');
    try {
      await appwriteAuth.requestPasswordRecovery(email);
      setNotice('If the account exists, a password recovery link has been sent.');
    } catch (failure) {
      const issue = failure as { message?: string };
      setError(issue.message || 'Could not request password recovery.');
    } finally { setLoading(false); }
  };

  return (
    <main className="min-h-[80vh] flex items-center justify-center px-4 py-10">
      <section className="w-full max-w-md space-y-5">
        <header className="text-center space-y-2">
          <img src="/app-icon.jpg" alt="Testagram" className="mx-auto h-14 w-14 rounded-2xl" />
          <h1 className="text-2xl font-black">Testagram</h1>
          <p className="text-sm text-muted-foreground">Secure sign-in powered by Appwrite</p>
        </header>
        {mode === 'signup' && !legalReady ? (
          <LegalAcceptanceGate onAccepted={() => setLegalReady(true)} />
        ) : (
          <div className="rounded-3xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex gap-2">
              <Button type="button" variant={mode === 'signin' ? 'default' : 'outline'} onClick={() => { setMode('signin'); setError(''); }}>Sign in</Button>
              <Button type="button" variant="outline" onClick={() => { setMode('signup'); setError(''); }} disabled={mode === 'reset' || mode === 'otp'}>Create account</Button>
            </div>
            {notice && <p role="status" className="rounded-xl bg-muted p-3 text-sm">{notice}</p>}
            {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
            {mode === 'signin' && <form onSubmit={submitSignIn} className="space-y-3">
              <Input type="email" autoComplete="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} required />
              <Input type="password" autoComplete="current-password" placeholder="Appwrite password" value={password} onChange={e => setPassword(e.target.value)} required />
              <Button className="w-full" disabled={loading}>{loading ? 'Please wait…' : 'Sign in'}</Button>
              <button type="button" className="text-sm text-primary underline" onClick={() => setMode('recover')}>Forgot password?</button>
              <button type="button" className="text-sm text-primary underline" onClick={() => { setMode('migrate'); setError(''); setNotice(''); }}>Move an existing Testagram account to Appwrite</button>
            </form>}
            {mode === 'signup' && legalReady && <form onSubmit={submitSignUp} className="space-y-3">
              <Input type="text" placeholder="Display name" value={displayName} onChange={e => setDisplayName(e.target.value)} required maxLength={80} />
              <Input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={30} />
              <Input type="email" autoComplete="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} required />
              <p className="text-xs text-muted-foreground">You will verify your email, complete Testagram's private identity verification, then create your Appwrite password. Your account is not created before KYC approval.</p>
              <Button className="w-full" disabled={loading}>{loading ? 'Starting secure registration…' : 'Continue to email verification'}</Button>
            </form>}
            {mode === 'otp' && <form onSubmit={verifyRegistrationEmail} className="space-y-3">
              <Input inputMode="numeric" autoComplete="one-time-code" placeholder="Six-digit email code" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} required />
              <Button className="w-full" disabled={loading || otp.length !== 6}>{loading ? 'Verifying…' : 'Verify email and continue'}</Button>
              <button type="button" className="text-sm text-primary underline" onClick={() => void resendRegistrationEmail()}>Resend code</button>
            </form>}
            {mode === 'migrate' && <form onSubmit={submitExistingMigration} className="space-y-3">
              <h2 className="font-semibold">Migrate your existing Testagram account</h2>
              <p className="text-xs text-muted-foreground">First we verify your current Testagram password. Then Appwrite creates a new sign-in identity. After email verification, the Backend links it to your original canonical profile. Posts, followers and messages are not recreated.</p>
              <Input type="email" autoComplete="email" placeholder="Existing Testagram email" value={email} onChange={e => setEmail(e.target.value)} required />
              <Input type="password" autoComplete="current-password" placeholder="Existing Testagram password" value={legacyPassword} onChange={e => setLegacyPassword(e.target.value)} required />
              <Input type="password" autoComplete="new-password" placeholder="New Appwrite password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
              <Input type="password" autoComplete="new-password" placeholder="Confirm new Appwrite password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required minLength={8} />
              <Button className="w-full" disabled={loading || password !== confirmation}>{loading ? 'Verifying and preparing…' : 'Verify existing account & create Appwrite identity'}</Button>
              <button type="button" className="text-sm text-primary underline" onClick={() => { setMode('signin'); setLegacyPassword(''); }}>Back to sign in</button>
            </form>}
            {mode === 'recover' && <form onSubmit={requestRecovery} className="space-y-3">
              <Input type="email" autoComplete="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} required />
              <Button className="w-full" disabled={loading}>{loading ? 'Sending…' : 'Send recovery link'}</Button>
              <button type="button" className="text-sm text-primary underline" onClick={() => setMode('signin')}>Back to sign in</button>
            </form>}
            {mode === 'reset' && <form onSubmit={submitRecovery} className="space-y-3">
              <Input type="password" autoComplete="new-password" placeholder="New password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
              <Input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required minLength={8} />
              <Button className="w-full" disabled={loading || !recovery}>{loading ? 'Updating…' : 'Update password'}</Button>
            </form>}
            {linkRequired && <form onSubmit={submitLegacyLink} className="space-y-3 border-t pt-4">
              <h2 className="font-semibold">Link your existing Testagram account</h2>
              <p className="text-xs text-muted-foreground">Sign in to your old account once to prove ownership. Your existing canonical user ID and social data will be preserved.</p>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Existing account email" required />
              <Input type="password" value={legacyPassword} onChange={e => setLegacyPassword(e.target.value)} placeholder="Existing account password" required />
              <Button className="w-full" disabled={loading}>{loading ? 'Verifying both accounts…' : 'Verify and link accounts'}</Button>
            </form>}
          </div>
        )}
      </section>
    </main>
  );
}
