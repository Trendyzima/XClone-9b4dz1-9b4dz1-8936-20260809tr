import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { authService, finalizeAuthenticatedSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useSEO } from '@/hooks/useSEO';
import { useAuthStore } from '@/stores/authStore';

function AuthAdBanner() {
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) return;
    pushed.current = true;
    try {
      ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
    } catch {
      // Ad loading must never block authentication.
    }
  }, []);

  return (
    <ins
      className="adsbygoogle"
      style={{ display: 'block' }}
      data-ad-client="ca-pub-2458567543017441"
      data-ad-slot="2031881558"
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}

type AuthMode = 'signin' | 'signup' | 'verify' | 'verify-phone';
type AuthMethod = 'email' | 'phone';

export default function AuthPage() {
  useSEO({ noindex: true, title: 'Sign In', url: '/auth' });

  const [mode, setMode] = useState<AuthMode>('signin');
  const [method, setMethod] = useState<AuthMethod>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifiedPhone, setVerifiedPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [username, setUsername] = useState('');
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [verificationPurpose, setVerificationPurpose] = useState<'otp' | 'signup'>('otp');
  const { toast } = useToast();
  const navigate = useNavigate();
  const authUser = useAuthStore((state) => state.user);
  const login = useAuthStore((state) => state.login);

  useEffect(() => {
    if (authUser && !pendingUserId && mode !== 'verify' && mode !== 'verify-phone') {
      navigate('/', { replace: true });
    }
  }, [authUser, pendingUserId, mode, navigate]);

  useEffect(() => {
    if (!pendingUserId) return;
    if (authUser?.id === pendingUserId) {
      navigate('/', { replace: true });
      return;
    }

    const timeout = window.setTimeout(() => {
      setPendingUserId(null);
      setLoading(false);
      toast({
        title: 'Sign-in is taking too long',
        description: 'Your session was created, but the app did not finish loading it. Please try again.',
        variant: 'destructive',
      });
    }, 8000);

    return () => window.clearTimeout(timeout);
  }, [pendingUserId, authUser?.id, navigate, toast]);

  const finishLogin = async (user: any) => {
    if (!user) throw new Error('Authentication succeeded but no user was returned');
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user || data.user.id !== user.id) {
      throw new Error('Authentication succeeded but the session could not be confirmed');
    }
    const finalized = await finalizeAuthenticatedSession(data.user);
    login(finalized);
    setPendingUserId(null);
    setLoading(false);
    navigate('/', { replace: true });
  };

  const handlePasswordSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const user = await authService.signInWithPassword(email, password);
      login(await finalizeAuthenticatedSession(user));
      navigate('/', { replace: true });
    } catch (error: any) {
      setLoading(false);
      toast({ title: 'Sign-in error', description: error?.message || 'Unable to sign in.', variant: 'destructive' });
    }
  };

  const handleResetPassword = async () => {
    if (!email.trim() || !email.includes('@')) {
      toast({ title: 'Enter your email first', description: 'Password recovery uses your email address.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      await authService.resetPassword(email);
      toast({ title: 'Reset link sent', description: 'Check your email for the password reset link.' });
    } catch (error: any) {
      toast({ title: 'Password reset error', description: error?.message || 'Unable to send the reset link.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8 || password !== confirmation) {
      toast({ title: 'Check your password', description: password !== confirmation ? 'Passwords do not match.' : 'Password must be at least 8 characters.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const result = await authService.signUpWithPassword(email, password, username);
      if (result.session) {
        const user = await finalizeAuthenticatedSession(result.session.user);
        login(user);
        navigate('/', { replace: true });
        return;
      }
      setLoading(false);
      setVerificationPurpose('signup');
      setOtp('');
      if (result.identifierKind === 'phone') {
        setPhone(result.identifier);
        setVerifiedPhone(result.identifier);
        setMode('verify-phone');
        toast({ title: 'Account created', description: 'Enter the 6-digit code sent to your phone to finish signing up.' });
      } else {
        setMode('verify');
        toast({ title: 'Account created', description: 'Check your email for the confirmation code or link to finish signing up.' });
      }
    } catch (error: any) {
      setLoading(false);
      toast({ title: 'Account creation error', description: error?.message || 'Unable to create account.', variant: 'destructive' });
    }
  };

  const handleSendEmailOtp = async (event?: React.FormEvent | React.MouseEvent) => {
    event?.preventDefault();
    setLoading(true);
    try {
      await authService.sendOtp(email);
      setOtp('');
      setLoading(false);
      setVerificationPurpose('otp');
      setMode('verify');
      toast({ title: 'Code sent', description: 'Enter the 6-digit code sent to your email.' });
    } catch (error: any) {
      setLoading(false);
      toast({ title: 'Email OTP error', description: error?.message || 'Unable to send email code.', variant: 'destructive' });
    }
  };

  const handleSendPhoneOtp = async (event?: React.FormEvent | React.MouseEvent) => {
    event?.preventDefault();
    setLoading(true);
    try {
      const normalized = await authService.sendPhoneOtp(phone);
      setPhone(normalized);
      setVerifiedPhone(normalized);
      setOtp('');
      setLoading(false);
      setVerificationPurpose('otp');
      setMode('verify-phone');
      toast({ title: 'OTP sent', description: 'Enter the 6-digit code sent by SMS.' });
    } catch (error: any) {
      setLoading(false);
      toast({ title: 'Phone OTP error', description: error?.message || 'Unable to send phone code.', variant: 'destructive' });
    }
  };

  const handleVerifyEmailOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await finishLogin(await authService.verifyEmailOtp(email, otp));
    } catch (error: any) {
      setLoading(false);
      toast({ title: 'Email verification error', description: error?.message || 'Invalid email code.', variant: 'destructive' });
    }
  };

  const handleVerifyPhoneOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await finishLogin(await authService.verifyPhoneOtp(phone, otp));
    } catch (error: any) {
      setLoading(false);
      toast({ title: 'Phone verification error', description: error?.message || 'Invalid phone code.', variant: 'destructive' });
    }
  };

  const handleResendVerification = async () => {
    setLoading(true);
    try {
      if (verificationPurpose === 'signup') {
        if (mode === 'verify-phone') await authService.resendSignupPhone(phone);
        else await authService.resendSignupEmail(email);
      } else if (mode === 'verify-phone') {
        await authService.sendPhoneOtp(phone);
      } else {
        await authService.sendOtp(email);
      }
      toast({ title: 'Code sent', description: 'A fresh verification code has been sent.' });
    } catch (error: any) {
      toast({ title: 'Could not resend code', description: error?.message || 'Please try again in a moment.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const changeIdentifier = () => {
    setOtp('');
    setLoading(false);
    setMode(method === 'phone' ? 'signin' : 'signin');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <AuthAdBanner />
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary mb-6">
            <span className="text-4xl font-bold text-primary-foreground">T</span>
          </div>
          <h2 className="text-3xl font-bold">
            {mode === 'signin' ? 'Sign in to T' : mode === 'signup' ? 'Join T today' : mode === 'verify-phone' ? 'Verify your phone' : 'Verify your email'}
          </h2>
        </div>

        {(mode === 'signin' || mode === 'signup') && (
          <>
            <form onSubmit={mode === 'signin' ? handlePasswordSignIn : handlePasswordSignUp} className="space-y-4">
              {mode === 'signup' && <Input type="text" autoComplete="username" placeholder="Username (optional)" value={username} onChange={(e) => setUsername(e.target.value)} className="h-14" />}
              <Input type="text" inputMode="email" autoComplete="username" placeholder="Email or Kenyan phone number" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-14" />
              <Input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="h-14" />
              {mode === 'signup' && <Input type="password" autoComplete="new-password" placeholder="Confirm password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required minLength={8} className="h-14" />}
              <Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : mode === 'signin' ? 'Sign in with password' : 'Create account'}</Button>
            </form>
            <div className="text-center text-sm">
              <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} className="text-primary hover:underline">
                {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted">
              <Button type="button" variant={method === 'email' ? 'default' : 'ghost'} className="rounded-lg" onClick={() => setMethod('email')}>Email OTP</Button>
              <Button type="button" variant={method === 'phone' ? 'default' : 'ghost'} className="rounded-lg" onClick={() => setMethod('phone')}>Phone OTP</Button>
            </div>
            {method === 'email' ? (
              <form onSubmit={handleSendEmailOtp} className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">Use a 6-digit code. The same flow signs in existing accounts and creates new accounts.</p>
                <Input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required className="h-14" />
                <Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send email code'}</Button>
              </form>
            ) : (
              <form onSubmit={handleSendPhoneOtp} className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">Use your Kenyan mobile number. SMS OTP signs in existing phone accounts or creates a new one.</p>
                <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={phone} onChange={(event) => setPhone(event.target.value)} required className="h-14" />
                <Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send phone code'}</Button>
              </form>
            )}
            <div className="text-center"><button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} className="text-primary hover:underline">{mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}</button></div>
          </>
        )}

        {mode === 'verify' && (
          <form onSubmit={handleVerifyEmailOtp} className="space-y-4">
            <p className="text-muted-foreground text-center">Enter the 6-digit code sent to {email} to {verificationPurpose === 'signup' ? 'finish creating your account' : 'sign in'}.</p>
            <Input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required maxLength={6} minLength={6} className="h-14 text-center text-2xl tracking-widest" />
            <Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify and enter Testagram'}</Button>
            <button type="button" onClick={handleResendVerification} className="w-full text-primary hover:underline text-sm" disabled={loading}>Resend email code</button>
            <button type="button" onClick={changeIdentifier} className="w-full text-muted-foreground hover:underline text-sm">Use a different email or phone</button>
          </form>
        )}

        {mode === 'verify-phone' && (
          <form onSubmit={handleVerifyPhoneOtp} className="space-y-4">
            <p className="text-muted-foreground text-center">Enter the 6-digit code sent to {verifiedPhone || phone} to {verificationPurpose === 'signup' ? 'finish creating your account' : 'sign in'}.</p>
            <Input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit OTP" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required maxLength={6} minLength={6} className="h-14 text-center text-2xl tracking-widest" />
            <Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify and enter Testagram'}</Button>
            <button type="button" onClick={handleResendVerification} className="w-full text-primary hover:underline text-sm" disabled={loading}>Resend phone code</button>
            <button type="button" onClick={changeIdentifier} className="w-full text-muted-foreground hover:underline text-sm">Use a different email or phone</button>
          </form>
        )}
      </div>
    </div>
  );
}
