import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Phone, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export default function CompleteProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [phone, setPhone] = useState('+254');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void supabase
      .from('profile_contact_methods')
      .select('phone_e164')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.phone_e164) {
          setPhone(data.phone_e164);
          navigate('/', { replace: true });
          return;
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id, navigate]);

  const savePhone = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('set_my_mobile_phone', { p_phone: phone });
      if (error) throw error;
      if (!data?.ok || !data?.phone_e164) throw new Error('The mobile number was not accepted by the server.');
      toast({
        title: 'Mobile number added',
        description: 'Your number is now attached to your Testagram profile. It is not used for sign-in.',
      });
      navigate('/', { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save mobile number';
      toast({ title: 'Mobile number required', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  }

  if (!user) {
    navigate('/auth', { replace: true });
    return null;
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <section className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-xl">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Phone className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold text-center">Add your mobile number</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          A valid mobile number is required to complete your Testagram profile and power communication features.
        </p>
        <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground flex gap-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
          <span>Your mobile number is stored as private contact data and is not used as a Testagram sign-in method.</span>
        </div>
        <form onSubmit={savePhone} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mobile-phone">Mobile number</Label>
            <Input
              id="mobile-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+254712345678"
              disabled={saving}
              required
            />
            <p className="text-xs text-muted-foreground">Use international format, for example +254712345678. Kenyan 07/01 numbers are also accepted and normalized.</p>
          </div>
          <Button type="submit" className="w-full" disabled={saving || phone.trim().length < 8}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {saving ? 'Saving…' : 'Continue to Testagram'}
          </Button>
        </form>
      </section>
    </main>
  );
}
