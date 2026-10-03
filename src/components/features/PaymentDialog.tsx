import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import {
  Loader2, CreditCard, Smartphone, CheckCircle2,
  XCircle, Clock, ArrowRight, Phone
} from 'lucide-react';
import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount: number;           // USD amount shown to user
  amountKes?: number;       // KES amount for M-Pesa (optional override)
  type: 'boost_post' | 'premium' | 'verification' | 'deposit';
  metadata?: Record<string, any>;
  onSuccess?: () => void;
}

type Step = 'method' | 'mpesa_phone' | 'mpesa_waiting' | 'mpesa_success' | 'mpesa_failed' | 'paypal_details';
type PaymentMethod = 'mpesa' | 'paypal';

const USD_TO_KES = 130; // approximate rate

export function PaymentDialog({
  open,
  onOpenChange,
  amount,
  amountKes,
  type,
  metadata = {},
  onSuccess,
}: PaymentDialogProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('method');
  const [method, setMethod] = useState<PaymentMethod>('mpesa');
  const [loading, setLoading] = useState(false);

  // M-Pesa state
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [checkoutRequestId, setCheckoutRequestId] = useState('');
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // PayPal state
  const [paypalEmail, setPaypalEmail] = useState('');

  const kesAmount = amountKes ?? Math.ceil(amount * USD_TO_KES);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      stopPolling();
      setStep('method');
      setLoading(false);
      setMpesaPhone('');
      setCheckoutRequestId('');
      setPollCount(0);
      setPaypalEmail('');
    }
  }, [open]);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // ─── STK Push ───────────────────────────────────────────────────
  const initiateSTKPush = async () => {
    if (!user) return;
    if (mpesaPhone.replace(/\D/g, '').length < 9) {
      toast.error('Enter a valid M-Pesa phone number');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('mpesa-stk-push', {
        body: { phone: mpesaPhone, amount: kesAmount, purpose: type, metadata },
      });

      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const txt = await error.context?.text();
            msg = txt || msg;
          } catch {}
        }
        throw new Error(msg);
      }

      setCheckoutRequestId(data.checkout_request_id);
      setStep('mpesa_waiting');
      toast.success(data.customer_message || 'STK Push sent — check your phone!');

      // Poll for payment status every 5 s for up to 90 s (18 attempts)
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        setPollCount(attempts);

        if (attempts >= 18) {
          stopPolling();
          setStep('mpesa_failed');
          return;
        }

        const status = await checkPaymentStatus(data.checkout_request_id);
        if (status === 'completed') {
          stopPolling();
          setStep('mpesa_success');
          onSuccess?.();
        } else if (status === 'failed' || status === 'cancelled') {
          stopPolling();
          setStep('mpesa_failed');
        }
      }, 5000);
    } catch (err: any) {
      console.error('STK Push error:', err);
      toast.error(err.message || 'Failed to initiate M-Pesa payment');
    } finally {
      setLoading(false);
    }
  };

  const checkPaymentStatus = async (cid: string): Promise<string> => {
    try {
      const { data, error } = await supabase.functions.invoke('mpesa-stk-status', {
        body: { checkout_request_id: cid },
      });
      if (error) return 'pending';
      return data?.status ?? 'pending';
    } catch {
      return 'pending';
    }
  };

  // PayPal cannot be marked paid by the browser. This dialog only supports
  // server-authoritative M-Pesa for direct feature purchases. Wallet funding
  // through PayPal is handled by PayPalTopUp, which performs provider capture.
  const processPayPal = async () => {
    toast.info('For PayPal, fund your Testagram Wallet first, then complete the purchase from your wallet.');
    setStep('method');
  };

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'method' && 'Choose Payment Method'}
            {step === 'mpesa_phone' && 'M-Pesa Payment'}
            {step === 'mpesa_waiting' && 'Waiting for Payment'}
            {step === 'mpesa_success' && 'Payment Confirmed'}
            {step === 'mpesa_failed' && 'Payment Failed'}
            {step === 'paypal_details' && 'PayPal Payment'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">

          {/* ── Step: Method Selection ── */}
          {step === 'method' && (
            <>
              <div className="bg-primary/10 rounded-xl p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Amount</p>
                <p className="text-3xl font-bold">${amount.toFixed(2)}</p>
                <p className="text-sm text-muted-foreground mt-1">≈ KES {kesAmount.toLocaleString()}</p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => { setMethod('mpesa'); setStep('mpesa_phone'); }}
                  className="w-full p-4 border-2 border-border hover:border-green-500 rounded-xl transition-all flex items-center gap-4 group"
                >
                  <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center shrink-0">
                    <Smartphone className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-left flex-1">
                    <p className="font-bold">M-Pesa</p>
                    <p className="text-sm text-muted-foreground">Pay via STK Push — instant & secure</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-green-500 transition-colors" />
                </button>

                <button
                  disabled
                  onClick={() => { setMethod('paypal'); setStep('paypal_details'); }}
                  className="w-full p-4 border-2 border-border rounded-xl transition-all flex items-center gap-4 group opacity-60 cursor-not-allowed"
                >
                  <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
                    <CreditCard className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-left flex-1">
                    <p className="font-bold">PayPal <span className="text-xs font-normal text-muted-foreground">(Wallet funding)</span></p>
                    <p className="text-sm text-muted-foreground">Fund your wallet first, then pay securely</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-blue-500 transition-colors" />
                </button>
              </div>
            </>
          )}

          {/* ── Step: M-Pesa Phone Entry ── */}
          {step === 'mpesa_phone' && (
            <>
              <div className="bg-green-600/10 border border-green-600/20 rounded-xl p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">M-Pesa Amount</p>
                <p className="text-3xl font-bold text-green-600">KES {kesAmount.toLocaleString()}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mpesa-phone" className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  M-Pesa Phone Number
                </Label>
                <Input
                  id="mpesa-phone"
                  type="tel"
                  placeholder="0712 345 678"
                  value={mpesaPhone}
                  onChange={(e) => setMpesaPhone(e.target.value)}
                  className="text-lg h-12"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Safaricom number registered with M-Pesa (07XX or +254…)
                </p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setStep('method')}>
                  Back
                </Button>
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  disabled={loading || mpesaPhone.replace(/\D/g, '').length < 9}
                  onClick={initiateSTKPush}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Send STK Push
                </Button>
              </div>
            </>
          )}

          {/* ── Step: Waiting for M-Pesa ── */}
          {step === 'mpesa_waiting' && (
            <div className="text-center space-y-5 py-4">
              <div className="w-20 h-20 bg-green-600/10 rounded-full flex items-center justify-center mx-auto animate-pulse">
                <Smartphone className="w-10 h-10 text-green-600" />
              </div>
              <div>
                <h3 className="font-bold text-lg mb-1">Check Your Phone!</h3>
                <p className="text-muted-foreground text-sm">
                  An M-Pesa payment prompt of <strong>KES {kesAmount.toLocaleString()}</strong> has been sent to{' '}
                  <strong>{mpesaPhone}</strong>.
                </p>
                <p className="text-muted-foreground text-sm mt-2">
                  Enter your M-Pesa PIN to complete the payment.
                </p>
              </div>

              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4 animate-spin" />
                <span>Verifying payment… ({pollCount * 5}s)</span>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => { stopPolling(); setStep('method'); }}
              >
                Cancel
              </Button>
            </div>
          )}

          {/* ── Step: M-Pesa Success ── */}
          {step === 'mpesa_success' && (
            <div className="text-center space-y-5 py-4">
              <div className="w-20 h-20 bg-green-600/10 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              </div>
              <div>
                <h3 className="font-bold text-xl mb-1 text-green-600">Payment Confirmed!</h3>
                <p className="text-muted-foreground text-sm">
                  KES {kesAmount.toLocaleString()} received successfully via M-Pesa.
                </p>
              </div>
              <Button
                className="w-full bg-green-600 hover:bg-green-700"
                onClick={() => onOpenChange(false)}
              >
                Done
              </Button>
            </div>
          )}

          {/* ── Step: M-Pesa Failed ── */}
          {step === 'mpesa_failed' && (
            <div className="text-center space-y-5 py-4">
              <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
                <XCircle className="w-10 h-10 text-destructive" />
              </div>
              <div>
                <h3 className="font-bold text-xl mb-1 text-destructive">Payment Failed</h3>
                <p className="text-muted-foreground text-sm">
                  The M-Pesa payment was not completed. This could be because:
                </p>
                <ul className="text-sm text-muted-foreground mt-2 space-y-1 text-left list-disc list-inside">
                  <li>You cancelled the prompt</li>
                  <li>Wrong PIN entered</li>
                  <li>Insufficient M-Pesa balance</li>
                  <li>Request timed out</li>
                </ul>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  onClick={() => { setStep('mpesa_phone'); setPollCount(0); }}
                >
                  Try Again
                </Button>
              </div>
            </div>
          )}

          {/* ── Step: PayPal ── */}
          {step === 'paypal_details' && (
            <>
              <div className="bg-blue-600/10 border border-blue-600/20 rounded-xl p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">PayPal Amount</p>
                <p className="text-3xl font-bold text-blue-600">${amount.toFixed(2)}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="paypal-email">PayPal Email</Label>
                <Input
                  id="paypal-email"
                  type="email"
                  placeholder="you@example.com"
                  value={paypalEmail}
                  onChange={(e) => setPaypalEmail(e.target.value)}
                  className="h-12"
                  autoFocus
                />
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setStep('method')} disabled={loading}>
                  Back
                </Button>
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                  disabled={loading || !paypalEmail.includes('@')}
                  onClick={processPayPal}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Pay ${amount.toFixed(2)}
                </Button>
              </div>
            </>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}
