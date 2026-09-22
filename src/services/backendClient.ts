import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { supabase, supabasePublishableKey, supabaseUrl } from '@/lib/supabase';
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

export async function requireAccessToken(client: SupabaseClient = supabase): Promise<string> {
  // The composer can render immediately from the auth hook while Supabase Auth is
  // still hydrating its persisted session. Do not turn that short race into a
  // false "Authentication required" failure. Read the session, briefly retry
  // hydration, then explicitly refresh the session before failing closed.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await client.auth.getSession();
    if (error) lastError = error;
    const token = data.session?.access_token;
    if (token) return token;
    if (attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }

  const { data: refreshed, error: refreshError } = await client.auth.refreshSession();
  if (refreshError) lastError = refreshError;
  const refreshedToken = refreshed.session?.access_token;
  if (refreshedToken) return refreshedToken;

  throw new BackendClientError(
    lastError instanceof Error ? lastError.message : 'Please sign in again',
    { code: 'AUTH_REQUIRED', status: 401 },
  );
}

function extractFunctionError(error: unknown): BackendClientError {
  if (error instanceof FunctionsHttpError) return new BackendClientError(error.message || 'Edge Function request failed', { status: error.context?.status ?? null, code: 'EDGE_FUNCTION_ERROR', details: error.context });
  if (error instanceof Error) return new BackendClientError(error.message);
  return new BackendClientError('Backend request failed');
}

export async function invokeBackendFunction<TResponse = unknown, TBody extends Record<string, unknown> = Record<string, unknown>>(
  functionName: string,
  body: TBody,
  client: SupabaseClient = supabase,
): Promise<TResponse> {
  const accessToken = await requireAccessToken(client);
  const { data, error } = await client.functions.invoke(functionName, {
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error) throw extractFunctionError(error);
  return data as TResponse;
}

export function createBackendCapabilityClient(
  endpoint: string = "/api/capability",
  client: SupabaseClient = supabase,
): TestagramCapabilityClient {
  return new TestagramCapabilityClient({ endpoint, getAccessToken: () => requireAccessToken(client), clientName: 'testagram-web', clientVersion: '4', apiKey: supabasePublishableKey });
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
  client: SupabaseClient = supabase,
): Promise<MpesaStkPushResponse> {
  if (!Number.isFinite(request.amount_kes) || request.amount_kes < 10) throw new BackendClientError('M-Pesa amount must be at least KES 10', { code: 'INVALID_AMOUNT' });
  if (!request.metadata?.wallet_id) throw new BackendClientError('Wallet identity is required', { code: 'WALLET_ID_REQUIRED' });

  trackTestagramEvent(TestagramEvent.WALLET_DEPOSIT_STARTED, {
    provider: 'mpesa',
    amount_kes: request.amount_kes,
  });

  const result = await invokeBackendFunction<MpesaStkPushResponse, MpesaStkPushRequest>('mpesa-stk-push', request, client);
  if (result.status === 'success') {
    trackTestagramEvent(TestagramEvent.WALLET_DEPOSIT_COMPLETED, {
      provider: 'mpesa',
      amount_kes: result.amount_kes ?? request.amount_kes,
    });
  }
  return result;
}
