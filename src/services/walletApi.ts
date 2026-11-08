import { backendCapabilities } from '@/services/testagramCapabilityClient';

export type WalletCurrency = 'KES' | 'USD';
export type WalletTransaction = {
  id: string;
  kind: string;
  amount: string | number;
  currency: WalletCurrency;
  created_at: string;
  transfer_id?: string;
  sender_id?: string;
  recipient_id?: string;
  note?: string;
  status?: 'initiating' | 'pending' | 'settled' | 'completed' | 'failed';
  provider?: string;
  receipt_number?: string;
  phone?: string;
  amount_kes?: string | number;
  wallet_amount?: string | number;
};

export const walletApi = {
  getSnapshot(limit = 50, currency: WalletCurrency = 'KES') {
    return backendCapabilities.getWallet(limit, undefined, currency);
  },
  listTransactions(limit = 50) {
    return backendCapabilities.getWalletTransactions(limit).then(result => ({
      items: (result.items ?? []) as WalletTransaction[],
      next_cursor: result.next_cursor ?? null,
    }));
  },
  resolveRecipient(username: string) {
    return backendCapabilities.call<{ user_id: string; username: string }>('testagram.wallet.recipient.resolve', { username: username.trim().replace(/^@/, '') });
  },
  transfer(recipientId: string, amount: number, note = '', idempotencyKey = crypto.randomUUID()) {
    return backendCapabilities.transferWallet(recipientId, amount, note, idempotencyKey);
  },
  tip(recipientId: string, amount: number, note = '', idempotencyKey = crypto.randomUUID()) {
    return backendCapabilities.tipWallet(recipientId, amount, note, idempotencyKey);
  },
  requestMpesaTopUp(input: { phone: string; amountKes: number; currency?: WalletCurrency; idempotencyKey?: string }) {
    return backendCapabilities.call<{
      status: 'pending' | 'settled' | 'failed';
      checkout_request_id?: string;
      merchant_request_id?: string;
      request_reference?: string;
      amount_kes?: number;
      wallet_amount?: number;
      currency?: WalletCurrency;
      duplicate?: boolean;
    }>('testagram.wallet.mpesa.stk_push', {
      phone: input.phone,
      amount_kes: input.amountKes,
      currency: input.currency ?? 'KES',
      idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    });
  },
  getMpesaTopUpStatus(checkoutRequestId: string) {
    return backendCapabilities.call<{
      status: 'initiating' | 'pending' | 'settled' | 'failed';
      checkout_request_id: string;
      receipt_number: string;
      amount_kes: string;
      wallet_amount: string;
      currency: WalletCurrency;
      created_at: string;
    }>('testagram.wallet.mpesa.status', { checkout_request_id: checkoutRequestId });
  },
};
