import { TestagramApiError, testagramApiRequest } from '@/services/apiClient';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';

export async function createPesapalPayment(amount: number, email: string, phone: string) {
  if (!Number.isFinite(amount) || amount <= 0 || !email.trim() || !phone.trim()) {
    throw new Error('A valid payment amount, email and phone number are required.');
  }
  trackTestagramEvent(TestagramEvent.WALLET_DEPOSIT_STARTED, { provider: 'pesapal', amount, currency: 'USD' });
  try {
    // PesaPal is deliberately fail-closed until the Backend owns its order,
    // callback verification and wallet-credit lifecycle. No Edge Function call.
    return await testagramApiRequest<{
      ok: boolean; merchant_reference: string; order_tracking_id: string;
      redirect_url: string; currency: string; amount: number; merchant_country: string;
    }>('/api/wallet/pesapal/orders', {
      method: 'POST',
      body: { amount, currency: 'USD', email: email.trim(), phone: phone.trim(), description: 'Testagram wallet top-up' },
    });
  } catch (error) {
    trackTestagramEvent(TestagramEvent.CAPABILITY_FAILED, {
      capability: 'wallet.pesapal.create', provider: 'pesapal', amount, currency: 'USD',
      error_type: error instanceof Error ? error.name : 'unknown',
    });
    if (error instanceof TestagramApiError && error.status === 404) {
      throw new Error('PesaPal payments are not enabled by the Testagram Backend yet.');
    }
    throw error;
  }
}
