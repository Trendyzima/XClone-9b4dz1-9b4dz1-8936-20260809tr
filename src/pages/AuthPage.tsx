import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { authService } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useSEO } from '@/hooks/useSEO';
import { useAuthStore } from '@/stores/authStore';

function AuthAdBanner() {
  const pushed = useRef(false);
  useEffect(() => {
    if (pushed.current) return;
    pushed.current = true;
    try { ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({}); } catch {}
  }, []);
  return <ins className="adsbygoogle" style={{ display: 'block' }} data-ad-client="ca-pub-2458567543017441" data-ad-slot="2031881558" data-ad-format="auto" data-full-width-responsive="true" />;
}

type Mode = 'signin' | 'signup' | 'otp' | 'forgot' | 'reset';
type Method = 'email' | 'phone';

export default function AuthPage() {
  useSEO({ noindex: true, title: 'Sign In', url: '/auth' });
  const [mode, setMode] = useState<Mode>('signin');
  const [method, setMethod] = useState<Method>('email');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetReady, setResetReady] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authUser = useAuthStore((state) => state.user);

  useEffect(() => {
    if (searchParams.get('reset') === '1') setMode('reset');
  }, [searchParams]);

  useEffect(() => {
    if (authUser && mode !== 'reset') navigate('/', { replace: true });
  }, [authUser, mode, navigate]);

  const run = async (operation: () => Promise<void>, success?: string) => {
    setLoading(true);
    try {
      await operation();
      if (success) toast({ title: success });
    } catch (error: any) {
      toast({ title: 'Authentication error', description: error?.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const signIn = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const user = await authService.signInWithPassword(identifier, password);
      if (!user) throw new Error('No authenticated user was returned');
      navigate('/', { replace: true });
    });
  };

  const signUp = (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    void run(async () => {
      const { user, session } = await authService.signUpWithPassword(identifier, password, username);
      if (session) {
        navigate('/', { replace: true });
        return;
      }
      setMode(method === 'email' ? 'otp' : 'signin');
      setOtp('');
      toast({
        title: method === 'email' ? 'Check your email' : 'Verify your phone',
        description: method === 'email' ? 'Your account was created. Complete the verification step from Supabase Auth.' : 'Your account was created. Verify your phone before signing in.',
      });
    });
  };

  const sendOtp = (event?: React.FormEvent | React.MouseEvent) => {
    event?.preventDefault();
    void run(async () => {
      if (method === 'email') await authService.sendOtp(identifier);
      else {
        const normalized = await authService.sendPhoneOtp(identifier);
        setIdentifier(normalized);
      }
      setMode('otp');
      setOtp('');
    }, 'Verification code sent');
  };

  const verifyOtp = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const user = method === 'email'
        ? await authService.verifyEmailOtp(identifier, otp)
        : await authService.verifyPhoneOtp(identifier, otp);
      if (!user) throw new Error('Verification succeeded but no session was returned');
      navigate('/', { replace: true });
    });
  };

  const forgot = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await authService.sendPasswordReset(identifier);
      setResetReady(true);
    }, 'Password reset email requested');
  };

  const resetPassword = (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    void run(async () => {
      await authService.updatePassword(password);
      await supabase.auth.signOut();
      setPassword('');
      setConfirmation('');
      setMode('signin');
      toast({ title: 'Password updated', description: 'You can now sign in with your new password.' });
    });
  };

  const switchMode = (next: Mode) => {
    setLoading(false);
    setPassword('');
    setConfirmation('');
    setOtp('');
    setResetReady(false);
    setMode(next);
  };

  const title = mode === 'signin' ? 'Sign in to T' : mode === 'signup' ? 'Join T today' : mode === 'forgot' ? 'Reset your password' : mode === 'reset' ? 'Choose a new password' : 'Enter your code';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <AuthAdBanner />
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary mb-5"><span className="text-4xl font-bold text-primary-foreground">T</span></div>
          <h2 className="text-3xl font-bold">{title}</h2>
        </div>

        {mode === 'signin' && (
          <>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted">
              <Button type="button" variant={method === 'email' ? 'default' : 'ghost'} onClick={() => setMethod('email')}>Email</Button>
              <Button type="button" variant={method === 'phone' ? 'default' : 'ghost'} onClick={() => setMethod('phone')}>Phone</Button>
            </div>
            <form onSubmit={signIn} className="space-y-4">
              <Input type={method === 'email' ? 'email' : 'tel'} inputMode={method === 'email' ? 'email' : 'tel'} autoComplete={method === 'email' ? 'email' : 'tel'} placeholder={method === 'email' ? 'you@example.com' : '0712 345 678'} value={identifier} onChange={(e) => setIdentifier(e.target.value)} required className="h-14" />
              <Input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-14" />
              <Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Sign in'}</Button>
            </form>
            <div className="flex justify-between text-sm">
              <button type="button" onClick={() => switchMode('forgot')} className="text-primary hover:underline">Forgot password?</button>
              <button type="button" onClick={() => switchMode('otp')} className="text-primary hover:underline">Use OTP instead</button>
            </div>
            <div className="text-center text-sm"><button type="button" onClick={() => switchMode('signup')} className="text-primary hover:underline">Don't have an account? Sign up</button></div>
          </>
        )}

        {mode === 'signup' && (
          <>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted">
              <Button type="button" variant={method === 'email' ? 'default' : 'ghost'} onClick={() => setMethod('email')}>Email</Button>
              <Button type="button" variant={method === 'phone' ? 'default' : 'ghost'} onClick={() => setMethod('phone')}>Phone</Button>
            </div>
            <form onSubmit={signUp} className="space-y-4">
              <Input type={method === 'email' ? 'email' : 'tel'} placeholder={method === 'email' ? 'you@example.com' : '0712 345 678'} value={identifier} onChange={(e) => setIdentifier(e.target.value)} required className="h-14" />
              <Input type="text" autoComplete="username" placeholder="Username (optional)" value={username} onChange={(e) => setUsername(e.target.value)} className="h-14" />
              <Input type="password" autoComplete="new-password" placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="h-14" />
              <Input type="password" autoComplete="new-password" placeholder="Confirm password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required minLength={8} className="h-14" />
              <Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create account'}</Button>
            </form>
            <div className="text-center text-sm"><button type="button" onClick={() => switchMode('signin')} className="text-primary hover:underline">Already have an account? Sign in</button></div>
          </>
        )}

        {mode === 'forgot' && (
          <form onSubmit={forgot} className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">Enter your account email. We will send a secure password-reset link.</p>
            <Input type="email" autoComplete="email" placeholder="you@example.com" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required className="h-14" />
            <Button type="submit" className="w-full h-12 rounded-full" disabled={loading || resetReady}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : resetReady ? 'Reset email requested' : 'Send reset link'}</Button>
            <button type="button" onClick={() => switchMode('signin')} className="w-full text-sm text-primary hover:underline">Back to sign in</button>
          </form>
        )}

        {mode === 'otp' && (
          <form onSubmit={verifyOtp} className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">Enter the 6-digit code for {identifier}.</p>
            <Input inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} required minLength={6} maxLength={6} className="h-14 text-center text-2xl tracking-widest" />
            <Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify and enter Testagram'}</Button>
            <button type="button" onClick={() => void sendOtp()} className="w-full text-sm text-primary hover:underline" disabled={loading}>Resend code</button>
            <button type="button" onClick={() => switchMode('signin')} className="w-full text-sm text-muted-foreground hover:underline">Back to sign in</button>
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={resetPassword} className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">Choose a new password for your account.</p>
            <Input type="password" autoComplete="new-password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="h-14" />
            <Input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required minLength={8} className="h-14" />
            <Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Update password'}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
