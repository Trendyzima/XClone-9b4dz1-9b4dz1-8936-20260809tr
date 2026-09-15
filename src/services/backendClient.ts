import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { TestagramCapabilityClient } from '@/services/testagramCapabilityClient';

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
  const { data, error } = await client.auth.getSession();
  if (error) throw new BackendClientError(error.message, { code: 'SESSION_READ_FAILED' });
  const token = data.session?.access_token;
  if (!token) throw new BackendClientError('Please sign in again', { code: 'AUTH_REQUIRED', status: 401 });
  return token;
}

function extractFunctionError(error: unknown): BackendClientError {
  if (error instanceof FunctionsHttpError) {
    return new BackendClientError(error.message || 'Edge Function request failed', {
      status: error.context?.status ?? null,
      code: 'EDGE_FUNCTION_ERROR',
      details: error.context,
    });
  }
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

/** Canonical capability-plane client; callers may supply an explicit endpoint for compatibility. */
export function createBackendCapabilityClient(
  endpoint: string = `${import.meta.env.VITE_SUPABASE_URL ?? 'https://placeholder.supabase.co'}/functions/v1/capability-gateway`,
  client: SupabaseClient = supabase,
): TestagramCapabilityClient {
  return new TestagramCapabilityClient({
    endpoint,
    getAccessToken: () => requireAccessToken(client),
    clientName: 'testagram-web',
    clientVersion: '4',
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
  client: SupabaseClient = supabase,
): Promise<MpesaStkPushResponse> {
  if (!Number.isFinite(request.amount_kes) || request.amount_kes < 10) {
    throw new BackendClientError('M-Pesa amount must be at least KES 10', { code: 'INVALID_AMOUNT' });
  }
  if (!request.metadata?.wallet_id) {
    throw new BackendClientError('Wallet identity is required', { code: 'WALLET_ID_REQUIRED' });
  }
  return invokeBackendFunction<MpesaStkPushResponse, MpesaStkPushRequest>('mpesa-stk-push', request, client);
}
