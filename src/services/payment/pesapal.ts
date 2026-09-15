import { supabase } from '@/lib/supabase';

export async function createPesapalPayment(amount: number, email: string, phone: string) {
  const { data, error } = await supabase.functions.invoke('pesapal-create-order', {
    body: { amount, currency: 'USD', email, phone, description: 'Testagram wallet top-up' },
  });

  if (error) throw error;
  if (!data?.redirect_url) throw new Error(data?.error || 'PesaPal did not return a payment link');
  return data as {
    ok: boolean;
    merchant_reference: string;
    order_tracking_id: string;
    redirect_url: string;
    currency: string;
    amount: number;
    merchant_country: string;
  };
}
