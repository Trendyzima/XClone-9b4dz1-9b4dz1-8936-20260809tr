export type TestagramApiErrorBody = {
  code?: string;
  message?: string;
  request_id?: string;
  details?: unknown;
};

export class TestagramApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, code = 'API_REQUEST_FAILED', requestId: string | null = null, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'TestagramApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfterMs = retryAfterMs;
  }
}

export type TestagramApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: URLSearchParams | Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export type TestagramApiClientOptions = {
  baseURL?: string;
  getAccessToken: () => Promise<string>;
  fetcher?: typeof fetch;
  defaultTimeoutMs?: number;
  maxReadRetries?: number;
};

function requestId(): string {
  try { return globalThis.crypto.randomUUID(); }
  catch { return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(3000, Math.max(0, seconds * 1000));
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(3000, Math.max(0, date - Date.now()));
  }
  return Math.min(1000, 150 * (2 ** attempt));
}

function appendQuery(url: URL, query?: TestagramApiRequestOptions['query']): URL {
  if (!query) return url;
  if (query instanceof URLSearchParams) {
    query.forEach((value, key) => url.searchParams.set(key, value));
  } else {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function normalizeBaseURL(value: string): URL {
  let base: URL;
  try { base = new URL(value); }
  catch { throw new TestagramApiError('Testagram Backend API origin is not configured as an absolute URL.', 0, 'API_ORIGIN_INVALID'); }
  const localHTTP = base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !localHTTP) || base.username || base.password ||
      (base.pathname !== '/' && base.pathname !== '') || base.search || base.hash) {
    throw new TestagramApiError('Testagram Backend API origin must use HTTPS (HTTP only on localhost) and contain no credentials, path, query or fragment.', 0, 'API_ORIGIN_INVALID');
  }
  return base;
}

function normalizePath(path: string, base: URL): URL {
  if (typeof path !== 'string' || !path.startsWith('/v1/') || path.startsWith('/v1/internal/') ||
      path.startsWith('//') || /[\r\n\\]/.test(path)) {
    throw new TestagramApiError('Browser transport accepts public, versioned /v1 routes only.', 0, 'API_PATH_NOT_ALLOWED');
  }
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith('/v1/') || url.pathname.startsWith('/v1/internal/')) {
    throw new TestagramApiError('API request path escaped the configured Backend origin.', 0, 'API_PATH_NOT_ALLOWED');
  }
  return url;
}

function parseError(payload: any, response: Response, id: string): TestagramApiError {
  const error = payload?.error;
  const message = typeof error === 'string' ? error : error?.message ?? payload?.message;
  const code = typeof error === 'object' ? error?.code : payload?.code;
  const responseRequestId = payload?.request_id ?? response.headers.get('X-Request-ID') ?? id;
  const rawRetryAfter = response.headers.get('Retry-After');
  let retryAfterMs: number | null = null;
  if (rawRetryAfter) {
    const seconds = Number(rawRetryAfter);
    retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(rawRetryAfter) - Date.now());
  }
  return new TestagramApiError(
    message || `Testagram API request failed (HTTP ${response.status}).`,
    response.status,
    code || 'API_REQUEST_FAILED',
    responseRequestId,
    retryAfterMs,
  );
}

export function createTestagramApiClient(options: TestagramApiClientOptions) {
  const fetcher = options.fetcher ?? fetch;
  const maxReadRetries = Math.min(3, Math.max(0, options.maxReadRetries ?? 2));

  return {
    async request<T>(path: string, requestOptions: TestagramApiRequestOptions = {}): Promise<T> {
      const base = normalizeBaseURL((options.baseURL ?? '').trim());
      const url = appendQuery(normalizePath(path, base), requestOptions.query);
      const method = requestOptions.method ?? 'GET';
      const token = await options.getAccessToken();
      if (!token || /[\r\n]/.test(token)) {
        throw new TestagramApiError('A valid Testagram session is required.', 401, 'AUTH_REQUIRED');
      }

      const id = requestId();
      const headers = new Headers(requestOptions.headers);
      // Set protected headers after caller headers so they cannot be overridden.
      headers.set('Accept', 'application/json');
      headers.set('Authorization', `Bearer ${token}`);
      headers.set('X-Request-ID', id);
      headers.set('X-Testagram-API-Version', '1');
      if (requestOptions.body !== undefined) headers.set('Content-Type', 'application/json');
      if (requestOptions.idempotencyKey) headers.set('Idempotency-Key', requestOptions.idempotencyKey);

      const attempts = method === 'GET' ? maxReadRetries + 1 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const controller = new AbortController();
        const timeoutMs = Math.max(500, Math.min(30000, requestOptions.timeoutMs ?? options.defaultTimeoutMs ?? 10000));
        let timedOut = false;
        let callerAborted = false;
        const timer = globalThis.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
        const abortFromCaller = () => {
          callerAborted = true;
          controller.abort();
        };
        if (requestOptions.signal?.aborted) abortFromCaller();
        else requestOptions.signal?.addEventListener('abort', abortFromCaller, { once: true });

        let response: Response;
        let payload: any;
        try {
          response = await fetcher(url.toString(), {
            method,
            headers,
            body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
          });
          // Keep the timeout active until the response body has been consumed.
          payload = await response.json().catch(() => null) as any;
        } catch (error) {
          if (timedOut) throw new TestagramApiError('Testagram API request timed out.', 0, 'API_TIMEOUT', id);
          if (callerAborted) throw new TestagramApiError('Testagram API request was cancelled.', 0, 'API_ABORTED', id);
          throw new TestagramApiError('Testagram API is unreachable.', 0, 'API_NETWORK_ERROR', id);
        } finally {
          globalThis.clearTimeout(timer);
          requestOptions.signal?.removeEventListener('abort', abortFromCaller);
        }

        if (!response.ok) {
          if (method === 'GET' && attempt + 1 < attempts && [429, 502, 503, 504].includes(response.status)) {
            await new Promise(resolve => globalThis.setTimeout(resolve, retryDelay(response, attempt)));
            continue;
          }
          throw parseError(payload, response, id);
        }
        if (payload && typeof payload === 'object' && typeof payload.ok === 'boolean') {
          if (!payload.ok) throw parseError(payload, response, id);
          // Some mutation endpoints return a compact status object without a
          // data member; preserve it instead of turning a successful response
          // into undefined.
          if ('data' in payload) return payload.data as T;
          return payload as T;
        }
        return payload as T;
      }
      throw new TestagramApiError('Testagram API retries were exhausted.', 503, 'API_RETRIES_EXHAUSTED', id);
    },
  };
}
