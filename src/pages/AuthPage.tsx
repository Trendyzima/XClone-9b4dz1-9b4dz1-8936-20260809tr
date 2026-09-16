import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  const [mode, setMode] = useState('signin');
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifiedPhone, setVerifiedPhone] = useState('');
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const referrerIdRef = useRef(searchParams.get('ref'));
  const { login } = useAuthStore();

  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) {
      localStorage.setItem('ts-pending-ref', ref);
      if (mode === 'signin') setMode('signup');
    }
  }, []);

  const finishLogin = (user: any) => {
    if (!user) throw new Error('Authentication succeeded but no user was returned');
    login(authService.mapUser(user));
    navigate('/');
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await authService.signInWithPassword(email, password);
      finishLogin(user);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setLoading(false);
    }
  };

  const handleSendEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authService.sendOtp(email);
      setMode('verify');
      toast({ title: 'Success', description: 'Verification code sent to your email' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const normalized = await authService.sendPhoneOtp(phone);
      setPhone(normalized);
      setVerifiedPhone(normalized);
      setMode('verify-phone');
      toast({ title: 'OTP sent', description: `Verification code sent to ${normalized}` });
    } catch (error: any) {
      toast({ title: 'Phone OTP error', description: error.message, variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const recordReferral = async (newUserId: string) => {
    const refUsername = localStorage.getItem('ts-pending-ref') ?? referrerIdRef.current;
    if (!refUsername) return;
    localStorage.removeItem('ts-pending-ref');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refUsername);
    let referrerId: string | null = null;
    if (isUuid) referrerId = refUsername;
    else {
      const { data: refProfile } = await supabase.from('profiles').select('id').eq('username', refUsername).maybeSingle();
      referrerId = refProfile?.id ?? null;
    }
    if (!referrerId || referrerId === newUserId) return;
    const { error } = await supabase.from('referrals').insert({ invited_by: referrerId, invited_user: newUserId, credits_awarded: 100 }).select().single();
    if (error) return;
    await supabase.rpc('add_to_wallet', { p_user_id: referrerId, p_amount: 100 }).catch(() => {});
    await supabase.rpc('add_to_wallet', { p_user_id: newUserId, p_amount: 100 }).catch(() => {});
  };

  const handleVerifyEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await authService.verifyOtpAndSetPassword(email, otp, password);
      recordReferral(user.id).catch(() => {});
      finishLogin(user);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setLoading(false);
    }
  };

  const handleVerifyPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await authService.verifyPhoneOtp(phone, otp);
      recordReferral(user.id).catch(() => {});
      finishLogin(user);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setLoading(false);
    }
  };

  const pendingRef = typeof window !== 'undefined' ? (localStorage.getItem('ts-pending-ref') ?? searchParams.get('ref')) : null;
  const isPhoneFlow = method === 'phone';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <AuthAdBanner />
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary mb-6"><span className="text-4xl font-bold text-primary-foreground">T</span></div>
          <h2 className="text-3xl font-bold">
            {mode === 'signin' ? 'Sign in to T' : mode === 'signup' ? 'Join T today' : mode === 'verify-phone' ? 'Verify your phone' : 'Verify your email'}
          </h2>
          {pendingRef && mode !== 'signin' && <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20"><span className="text-xs font-bold text-primary">🎁 Invited by @{pendingRef}</span><span className="text-[10px] text-muted-foreground">· You'll both get 100 credits</span></div>}
        </div>

        {(mode === 'signin' || mode === 'signup') && (
          <>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted">
              <Button type="button" variant={method === 'email' ? 'default' : 'ghost'} className="rounded-lg" onClick={() => setMethod('email')}>Email</Button>
              <Button type="button" variant={method === 'phone' ? 'default' : 'ghost'} className="rounded-lg" onClick={() => setMethod('phone')}>Phone OTP</Button>
            </div>

            {mode === 'signin' && method === 'email' && <form onSubmit={handleSignIn} className="space-y-4"><Input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="h-14" /><Input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required className="h-14" /><Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Sign in'}</Button></form>}

            {mode === 'signin' && method === 'phone' && <form onSubmit={handleSendPhoneOtp} className="space-y-4"><p className="text-sm text-muted-foreground">Use your verified phone number to access your Testagram account.</p><Input type="tel" inputMode="tel" placeholder="0712 345 678" value={phone} onChange={e => setPhone(e.target.value)} required className="h-14" /><Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send phone OTP'}</Button></form>}

            {mode === 'signup' && method === 'email' && <form onSubmit={handleSendEmailOtp} className="space-y-4"><Input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="h-14" /><Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Continue with email'}</Button></form>}

            {mode === 'signup' && method === 'phone' && <form onSubmit={handleSendPhoneOtp} className="space-y-4"><p className="text-sm text-muted-foreground">Create a Testagram account with your Kenyan phone number. SMS OTP verification is the account credential.</p><Input type="tel" inputMode="tel" placeholder="0712 345 678" value={phone} onChange={e => setPhone(e.target.value)} required className="h-14" /><Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create with phone OTP'}</Button></form>}

            <div className="text-center"><button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} className="text-primary hover:underline">{mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}</button></div>
          </>
        )}

        {mode === 'verify' && <form onSubmit={handleVerifyEmailOtp} className="space-y-4"><p className="text-muted-foreground text-center">Enter the 4-digit code sent to {email}</p><Input type="text" inputMode="numeric" placeholder="Verification code" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} required maxLength={6} className="h-14 text-center text-2xl tracking-widest" /><Input type="password" placeholder="Create password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} className="h-14" /><Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify and create account'}</Button><button type="button" onClick={handleSendEmailOtp} className="w-full text-primary hover:underline text-sm" disabled={loading}>Resend code</button></form>}

        {mode === 'verify-phone' && <form onSubmit={handleVerifyPhoneOtp} className="space-y-4"><p className="text-muted-foreground text-center">Enter the 6-digit code sent to {verifiedPhone || phone}</p><Input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit OTP" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} required maxLength={6} className="h-14 text-center text-2xl tracking-widest" /><Button type="submit" className="w-full h-12 rounded-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify and enter Testagram'}</Button><button type="button" onClick={handleSendPhoneOtp} className="w-full text-primary hover:underline text-sm" disabled={loading}>Resend phone OTP</button></form>}
      </div>
    </div>
  );
}
