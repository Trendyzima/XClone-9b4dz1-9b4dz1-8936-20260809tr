import { appwriteAuth } from '@/services/appwriteAuth';
import { TestagramCapabilityClient } from '@/services/testagramCapabilityClient';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';

export type BackendFunctionError = {
  message: string;
  status?: number;
  code?: string;
  details?: unknown;
};

export class BackendClientError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly details: unknown;
  constructor(message: string, options: { status?: number | null; code?: string | null; details?: unknown } = {}) {
    super(message);
    this.name = 'BackendClientError';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.details = options.details ?? null;
  }
}

export async function requireAccessToken(_legacyClient?: unknown): Promise<string> {
  try { return await appwriteAuth.createBackendJWT(); }
  catch { throw new BackendClientError('Your Appwrite session is unavailable. Please sign in again.', { code: 'AUTH_REQUIRED', status: 401 }); }
}

/**
 * Legacy function names are deliberately not proxied. Each feature must use a
 * typed /v1 API route or a registered Backend capability; there is no legacy
 * function gateway or browser database fallback.
 */
export async function invokeBackendFunction<TResponse = unknown, TBody extends Record<string, unknown> = Record<string, unknown>>(
  functionName: string,
  _body: TBody,
  _legacyClient?: unknown,
): Promise<TResponse> {
  throw new BackendClientError(`Backend function "${functionName}" has not been migrated to a typed Testagram API route.`, {
    code: 'BACKEND_FUNCTION_NOT_MIGRATED',
    status: 501,
  });
}

export function createBackendCapabilityClient(
  endpoint = (import.meta.env.VITE_TESTAGRAM_API_URL ?? '').trim().replace(/\/+$/, '') ? \`\${(import.meta.env.VITE_TESTAGRAM_API_URL ?? '').trim().replace(/\/+$/, '')}/api/capability\` : '',
  _legacyClient?: unknown,
): TestagramCapabilityClient {
  return new TestagramCapabilityClient({
    endpoint,
    getAccessToken: () => requireAccessToken(),
    clientName: 'testagram-web',
    clientVersion: '5',
  });
}

export const backendCapabilities = createBackendCapabilityClient();

export type MpesaStkPushRequest = {
  amount_kes: number;
  phone: string;
  metadata: { wallet_id: string };
};
export type MpesaStkPushResponse = {
  success: boolean;
  status: 'pending' | 'success' | 'failed';
  checkout_request_id?: string;
  merchant_request_id?: string;
  customer_message?: string;
  amount_kes?: number;
  wallet_amount?: number;
  wallet_currency?: string;
};

export async function requestMpesaStkPush(
  request: MpesaStkPushRequest,
  _legacyClient?: unknown,
): Promise<MpesaStkPushResponse> {
  if (!Number.isFinite(request.amount_kes) || request.amount_kes < 10) {
    throw new BackendClientError('M-Pesa amount must be at least KES 10', { code: 'INVALID_AMOUNT' });
  }
  if (!request.metadata?.wallet_id) {
    throw new BackendClientError('Wallet identity is required', { code: 'WALLET_ID_REQUIRED' });
  }
  trackTestagramEvent(TestagramEvent.WALLET_DEPOSIT_STARTED, { provider: 'mpesa', amount_kes: request.amount_kes });
  const result = await backendCapabilities.call<MpesaStkPushResponse>('testagram.wallet.mpesa.stk_push', {
    amount_kes: request.amount_kes,
    phone: request.phone,
    wallet_id: request.metadata.wallet_id,
  });
  if (result.status === 'success') {
    trackTestagramEvent(TestagramEvent.WALLET_DEPOSIT_COMPLETED, {
      provider: 'mpesa',
      amount_kes: result.amount_kes ?? request.amount_kes,
    });
  }
  return result;
}
