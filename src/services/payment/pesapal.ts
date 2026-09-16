import { supabase } from '@/lib/supabase';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';

export async function createPesapalPayment(amount: number, email: string, phone: string) {
  trackTestagramEvent(TestagramEvent.WALLET_DEPOSIT_STARTED, {
    provider: 'pesapal',
    amount,
    currency: 'USD',
  });

  try {
    const { data, error } = await supabase.functions.invoke('pesapal-create-order', {
      body: { amount, currency: 'USD', email, phone, description: 'Testagram wallet top-up' },
    });

    if (error) throw error;
    if (!data?.redirect_url) throw new Error(data?.error || 'PesaPal did not return a payment link');

    trackTestagramEvent(TestagramEvent.WALLET_DEPOSIT_COMPLETED, {
      provider: 'pesapal',
      amount,
      currency: 'USD',
      status: 'checkout_created',
    });

    return data as {
      ok: boolean;
      merchant_reference: string;
      order_tracking_id: string;
      redirect_url: string;
      currency: string;
      amount: number;
      merchant_country: string;
    };
  } catch (error) {
    trackTestagramEvent(TestagramEvent.CAPABILITY_FAILED, {
      capability: 'pesapal-create-order',
      provider: 'pesapal',
      amount,
      currency: 'USD',
      error_type: error instanceof Error ? error.name : 'unknown',
    });
    throw error;
  }
}
