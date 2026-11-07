import { appwriteAuth } from '@/services/appwriteAuth';
import { TestagramCapabilityClient } from '@/services/testagramCapabilityClient';
import { testagramApi } from '@/services/testagramApi';
import type { TestagramApiRequestOptions } from '@/services/testagramApiClient';
import { TestagramApiError } from '@/services/testagramApiClient';
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

/** Public browser requests may use only versioned Backend API routes. */
export function requestBackendAPI<T>(path: string, options: TestagramApiRequestOptions = {}): Promise<T> {
  if (!path.startsWith('/v1/') || path.startsWith('/v1/internal/')) {
    throw new BackendClientError('Browser requests must use public, versioned Backend API routes.', {
      code: 'API_PATH_NOT_ALLOWED',
      status: 400,
    });
  }
  return testagramApi.request<T>(path, options).catch((error: unknown) => {
    if (error instanceof BackendClientError) throw error;
    if (error instanceof TestagramApiError) {
      throw new BackendClientError(error.message, {
        status: error.status,
        code: error.code,
        details: error.requestId,
      });
    }
    if (error instanceof Error) throw new BackendClientError(error.message, { code: 'BACKEND_API_ERROR' });
    throw new BackendClientError('Backend request failed.');
  });
}

/** Appwrite is the only browser identity provider. */
export async function requireAccessToken(_legacyClient?: unknown): Promise<string> {
  try {
    return await appwriteAuth.createBackendJWT();
  } catch {
    throw new BackendClientError('Your Appwrite session is unavailable. Please sign in again.', {
      code: 'AUTH_REQUIRED',
      status: 401,
    });
  }
}

/**
 * Compatibility entry point for old feature call sites. Function-name based
 * Edge Function dispatch is intentionally disabled: each operation must be
 * migrated to an explicit public Backend API route before it can be enabled.
 */
export async function invokeBackendFunction<
  TResponse = unknown,
  TBody extends Record<string, unknown> = Record<string, unknown>,
>(
  functionName: string,
  _body: TBody,
  _legacyClient?: unknown,
): Promise<TResponse> {
  throw new BackendClientError(
    `Backend operation "${functionName}" has not yet been ported to a public versioned API route.`,
    { code: 'FRESH_API_FUNCTION_NOT_PORTED', status: 503 },
  );
}

export function createBackendCapabilityClient(
  endpoint = '/v1/capabilities',
  _legacyClient?: unknown,
): TestagramCapabilityClient {
  return new TestagramCapabilityClient({
    endpoint,
    getAccessToken: async () => {
      try { return await appwriteAuth.createBackendJWT(); }
      catch { return null; }
    },
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

  trackTestagramEvent(TestagramEvent.WALLET_DEPOSIT_STARTED, {
    provider: 'mpesa',
    amount_kes: request.amount_kes,
  });

  // The payment route must be implemented and secured by Backend before the
  // browser can initiate a charge. Do not revive a legacy Edge Function path.
  return invokeBackendFunction<MpesaStkPushResponse, MpesaStkPushRequest>('mpesa-stk-push', request);
}
