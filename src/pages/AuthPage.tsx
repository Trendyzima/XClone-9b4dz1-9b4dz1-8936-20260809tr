import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { authService } from '@/lib/auth';
import { useAuthStore } from '@/stores/authStore';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSEO } from '@/hooks/useSEO';

function AuthAdBanner() {
  const ref = useRef(false);
  useEffect(() => {
    if (ref.current) return;
    ref.current = true;
    try { ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({}); } catch (_) {}
  }, []);
  return <ins className="adsbygoogle" style={{ display: 'block' }} data-ad-client="ca-pub-2458567543017441" data-ad-slot="2031881558" data-ad-format="auto" data-full-width-responsive="true" />;
}

export default function AuthPage() {
  useSEO({ noindex: true, title: 'Sign In', url: '/auth' });
  const [mode, setMode] = useState<'signin' | 'signup' | 'verify' | 'verify-phone'>('signin');
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifiedPhone, setVerifiedPhone] = useState('');
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
    const authUser = useAuthStore((state) => state.user);

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
        description: 'Your authentication session was created, but the app did not finish loading it. Please try again.',
        variant: 'destructive',
      });
    }, 8000);
    return () => window.clearTimeout(timeout);
  }, [pendingUserId, authUser?.id, navigate, toast]);

  const finishLogin = async (user: any) => {
    if (!user) throw new Error('Authentication succeeded but no user was returned');

    // Confirm the Auth server has a live user/session before handing control
    // back to the single AuthProvider hydration path.
    const { data: { user: currentUser }, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!currentUser || currentUser.id !== user.id) {
      throw new Error('Authentication succeeded but the session could not be confirmed');
    }
    setPendingUserId(currentUser.id);
  };

  const handleSendEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authService.sendOtp(email);
      setOtp('');
      setMode('verify');
      toast({ title: 'Code sent', description: 'Enter the 6-digit code sent to your email.' });
    } catch (error: any) {
      toast({ title: 'Email OTP error', description: error.message, variant: 'destructive' });
      setLoading(false);
    }
  };

  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const normalized = await authService.sendPhoneOtp(phone);
      setPhone(normalized);
      setVerifiedPhone(normalized);
      setOtp('');
      setMode('verify-phone');
      toast({ title: 'OTP sent', description: 'Enter the 6-digit code sent by SMS.' });
    } catch (error: any) {
      toast({ title: 'Phone OTP error', description: error.message, variant: 'destructive' });
      setLoading(false);
    }
  };

  const handleVerifyEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await authService.verifyEmailOtp(email, otp);
      await finishLogin(user);
    } catch (error: any) {
      toast({ title: 'Email verification error', description: error.message, variant: 'destructive' });
      setLoading(false);
    }
  };

  const handleVerifyPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await authService.verifyPhoneOtp(phone, otp);
      await finishLogin(user);
    } catch (error: any) {
      toast({ title: 'Phone verification error', description: error.message, variant: 'destructive' });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <AuthAdBanner />
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary mb-6"><span className="text-4xl font-bold text-primary-foreground">T</span></div>
          <h2 className="text-3xl font-bold">
            {mode === 'signin' ? 'Sign in to T' : mode === 'signup' ? 'Join T today' : mode === 'verify-phone' ? 'Verify your phone' : 'Verify your email'}
          </h2>
        </div>

        {(mode === 'signin' || mode === 'signup') && (
          <>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted">
              <Button type="button" variant={method === 'email' ? 'default' : 'ghost'} className="rounded-lg" onClick={() => setMethod('email')}>Email OTP</Button>
              <Button type="button" variant={method === 'phone' ? 'default' : 'ghost'} className="rounded-lg" onClick={() => setMethod('phone')}>Phone OTP</Button>
            </div>

            {method === 'email' && (
              <form onSubmit={handleSendEmailOtp} className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">Use a 6-digit code. The same flow signs in existing accounts and creates new accounts.</p>
                <Input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required className="h-14" />
                <Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send email code'}</Button>
              </form>
            )}

            {method === 'phone' && (
              <form onSubmit={handleSendPhoneOtp} className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">Use your Kenyan mobile number. SMS OTP signs in existing phone accounts or creates a new one.</p>
                <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={phone} onChange={e => setPhone(e.target.value)} required className="h-14" />
                <Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send phone code'}</Button>
              </form>
            )}

            <div className="text-center">
              <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} className="text-primary hover:underline">
                {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
            </div>
          </>
        )}

        {mode === 'verify' && (
          <form onSubmit={handleVerifyEmailOtp} className="space-y-4">
            <p className="text-muted-foreground text-center">Enter the 6-digit code sent to {email}.</p>
            <Input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} required maxLength={6} minLength={6} className="h-14 text-center text-2xl tracking-widest" />
            <Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify and enter Testagram'}</Button>
            <button type="button" onClick={handleSendEmailOtp} className="w-full text-primary hover:underline text-sm" disabled={loading}>Resend email code</button>
          </form>
        )}

        {mode === 'verify-phone' && (
          <form onSubmit={handleVerifyPhoneOtp} className="space-y-4">
            <p className="text-muted-foreground text-center">Enter the 6-digit code sent to {verifiedPhone || phone}.</p>
            <Input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit OTP" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} required maxLength={6} minLength={6} className="h-14 text-center text-2xl tracking-widest" />
            <Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify and enter Testagram'}</Button>
            <button type="button" onClick={handleSendPhoneOtp} className="w-full text-primary hover:underline text-sm" disabled={loading}>Resend phone code</button>
          </form>
        )}
      </div>
    </div>
  );
}
