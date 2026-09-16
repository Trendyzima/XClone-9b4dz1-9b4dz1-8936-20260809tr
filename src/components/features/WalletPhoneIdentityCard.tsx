import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Phone, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useWallet } from '@/hooks/useWallet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const OTP_COOLDOWN_SECONDS = 60;

export function WalletPhoneIdentityCard() {
  const {
    wallet,
    phoneIdentity,
    phoneVerified,
    requestPhoneOtp,
    verifyPhoneOtp,
    loading: walletLoading,
  } = useWallet();

  const [phone, setPhone] = useState(phoneIdentity?.phone_e164 ?? wallet?.mpesa_phone ?? '');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (phoneIdentity?.phone_e164) {
      setPhone(phoneIdentity.phone_e164);
      setStep('phone');
      setOtp('');
    } else if (wallet?.mpesa_phone) {
      setPhone(wallet.mpesa_phone);
    }
  }, [phoneIdentity?.phone_e164, wallet?.mpesa_phone]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const requestOtp = async () => {
    if (sending || cooldown > 0) return;
    const normalized = phone.trim();
    if (!/^((\+254|254)\d{9}|0\d{9})$/.test(normalized)) {
      toast.error('Enter a valid Kenyan mobile number, e.g. 0712345678');
      return;
    }

    setSending(true);
    try {
      const result = await requestPhoneOtp(normalized);
      setPhone(result.phone);
      setOtp('');
      setStep('otp');
      setCooldown(OTP_COOLDOWN_SECONDS);
      toast.success(`Verification code sent to ${result.phone}`);
    } catch (error: any) {
      toast.error(error?.message || 'Could not send the verification code');
    } finally {
      setSending(false);
    }
  };

  const verifyOtp = async () => {
    if (verifying) return;
    const token = otp.replace(/\D/g, '');
    if (token.length < 6) {
      toast.error('Enter the 6-digit verification code');
      return;
    }

    setVerifying(true);
    try {
      const identity = await verifyPhoneOtp(phone, token);
      setPhone(identity.phone_e164);
      setOtp('');
      setStep('phone');
      toast.success(`${identity.phone_e164} is now the verified wallet address`);
    } catch (error: any) {
      toast.error(error?.message || 'Invalid or expired verification code');
    } finally {
      setVerifying(false);
    }
  };

  if (walletLoading || !wallet) return null;

  if (phoneVerified && phoneIdentity) {
    return (
      <div className="bg-card border-2 border-green-500/20 rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-green-500/10">
              <ShieldCheck className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h3 className="font-bold">Verified wallet phone</h3>
              <p className="text-xs text-muted-foreground mt-0.5">This verified number is the wallet's M-Pesa address.</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600">
            <CheckCircle2 className="w-4 h-4" /> Verified
          </span>
        </div>
        <div className="rounded-xl bg-muted/50 px-4 py-3 font-mono text-sm tracking-wide">
          {phoneIdentity.phone_e164}
        </div>
        <p className="text-xs text-muted-foreground">
          Deposits and withdrawals must use this verified address. Changing it requires a new OTP verification.
        </p>
        <Button variant="outline" className="w-full" onClick={() => { setStep('phone'); setOtp(''); }}>
          Change wallet phone
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-card border-2 border-primary/20 rounded-2xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10">
          <Phone className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-bold">Set your M-Pesa wallet address</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Verify your Kenyan phone number by OTP before it can be used for M-Pesa payments.
          </p>
        </div>
      </div>

      {step === 'phone' ? (
        <div className="space-y-3">
          <label className="text-sm font-medium">M-Pesa phone number</label>
          <Input
            value={phone}
            onChange={event => setPhone(event.target.value)}
            placeholder="0712345678"
            inputMode="tel"
            autoComplete="tel"
            className="h-12"
            disabled={sending}
          />
          <Button className="w-full h-11" onClick={requestOtp} disabled={sending || cooldown > 0}>
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Phone className="w-4 h-4 mr-2" />}
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send OTP'}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm">
            Code sent to <span className="font-semibold">{phone}</span>
          </div>
          <label className="text-sm font-medium">6-digit OTP</label>
          <Input
            value={otp}
            onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="h-12 text-center text-lg tracking-[0.35em]"
            disabled={verifying}
          />
          <Button className="w-full h-11" onClick={verifyOtp} disabled={verifying || otp.length < 6}>
            {verifying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
            Verify & link wallet
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setStep('phone')} disabled={verifying}>
              Change number
            </Button>
            <Button variant="ghost" className="flex-1" onClick={requestOtp} disabled={sending || cooldown > 0}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {cooldown > 0 ? `${cooldown}s` : 'Resend'}
            </Button>
          </div>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        OTP verification proves control of the number. The phone is stored as a wallet address; it is not treated as a replacement for your existing account security.
      </p>
    </div>
  );
}
