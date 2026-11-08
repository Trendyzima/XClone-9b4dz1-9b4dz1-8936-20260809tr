import { appwriteAuth } from '@/services/appwriteAuth';

export type TestagramApiErrorBody = {
  code?: string;
  message?: string;
  error?: { code?: string; message?: string } | string;
  request_id?: string;
};

export class TestagramApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(message: string, status: number, code = 'API_REQUEST_FAILED', requestId: string | null = null) {
    super(message);
    this.name = 'TestagramApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const origin = (import.meta.env.VITE_TESTAGRAM_API_URL ?? '').trim().replace(/\/+$/, '');
const timeoutMs = 15000;
let requestSequence = 0;

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  requestSequence = (requestSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `web-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function apiUrl(path: string): string {
  if (!origin) throw new TestagramApiError('VITE_TESTAGRAM_API_URL is required.', 503, 'API_URL_REQUIRED');
  const url = new URL(path, `${origin}/`);
  const base = new URL(origin);
  if (url.origin !== base.origin || !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/v1/')) {
    throw new TestagramApiError('Request is outside the Testagram public API boundary.', 400, 'API_PATH_REJECTED');
  }
  return url.toString();
}

export type TestagramApiRequest = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  anonymous?: boolean;\n  accessToken?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
};

export async function testagramApiRequest<T>(path: string, options: TestagramApiRequest = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const id = requestId();
  let token: string | null = null;
  if (!options.anonymous) {
    try {
      token = await appwriteAuth.createBackendJWT();
    } catch {
      throw new TestagramApiError('Your Appwrite session is unavailable. Please sign in again.', 401, 'AUTH_REQUIRED', id);
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Testagram-API-Version': '1',
    'X-Request-ID': id,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
  };
  const mutating = method !== 'GET';
  if (mutating && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] = options.idempotencyKey ?? id;
  }

  const controller = new AbortController();
  const timeout = Math.min(30000, Math.max(1000, options.timeoutMs ?? timeoutMs));
  const timer = globalThis.setTimeout(() => controller.abort(), timeout);
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const response = await fetch(apiUrl(path), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: unknown = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { /* non-JSON error handled below */ }
    const requestID = response.headers.get('X-Request-ID') ?? id;
    if (!response.ok) {
      const data = (payload && typeof payload === 'object' ? payload : {}) as TestagramApiErrorBody;
      const nested = data.error && typeof data.error === 'object' ? data.error : {};
      throw new TestagramApiError(
        nested.message ?? data.message ?? (typeof data.error === 'string' ? data.error : undefined) ?? `Testagram API returned HTTP ${response.status}.`,
        response.status,
        nested.code ?? data.code ?? 'API_REQUEST_FAILED',
        requestID,
      );
    }
    if (payload && typeof payload === 'object' && 'ok' in payload) {
      const envelope = payload as { ok?: boolean; data?: T | null; error?: TestagramApiErrorBody['error']; request_id?: string };
      if (envelope.ok === false || envelope.data === null) {
        throw new TestagramApiError(envelope.error?.message ?? 'The API returned no data.', response.status, envelope.error?.code ?? 'API_EMPTY_RESPONSE', envelope.request_id ?? requestID);
      }
      if ('data' in envelope) return envelope.data as T;
    }
    return payload as T;
  } catch (error) {
    if (error instanceof TestagramApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new TestagramApiError('Testagram API request timed out.', 0, 'TIMEOUT', id);
    }
    throw new TestagramApiError('Testagram API is unreachable. Check your connection and API URL.', 0, 'NETWORK_ERROR', id);
  } finally {
    globalThis.clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}
