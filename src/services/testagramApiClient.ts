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

function appendQuery(url: string, query?: TestagramApiRequestOptions['query']): string {
  if (!query) return url;
  const params = query instanceof URLSearchParams ? new URLSearchParams(query) : new URLSearchParams();
  if (!(query instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
  }
  const encoded = params.toString();
  return encoded ? `${url}${url.includes('?') ? '&' : '?'}${encoded}` : url;
}

function parseError(payload: any, response: Response, id: string): TestagramApiError {
  const error = payload?.error;
  const message = typeof error === 'string' ? error : error?.message ?? payload?.message;
  const code = typeof error === 'object' ? error?.code : payload?.code;
  const responseRequestId = payload?.request_id ?? response.headers.get('X-Request-ID') ?? id;
  return new TestagramApiError(
    message || `Testagram API request failed (HTTP ${response.status}).`,
    response.status,
    code || 'API_REQUEST_FAILED',
    responseRequestId,
    (() => {
      const raw = response.headers.get('Retry-After');
      if (!raw) return null;
      const seconds = Number(raw);
      return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(raw) - Date.now());
    })(),
  );
}

export function createTestagramApiClient(options: TestagramApiClientOptions) {
  const baseURL = (options.baseURL ?? '').trim().replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;
  const maxReadRetries = Math.min(3, Math.max(0, options.maxReadRetries ?? 2));

  return {
    async request<T>(path: string, requestOptions: TestagramApiRequestOptions = {}): Promise<T> {
      if (!path.startsWith('/v1/') || path.startsWith('/v1/internal/') || path.includes('\\') || path.includes('..') || path.includes('?') || path.includes('#')) {
        throw new TestagramApiError('Only safe public, versioned Backend API paths are allowed.', 0, 'API_PATH_NOT_ALLOWED');
      }
      const method = requestOptions.method ?? 'GET';
      const url = appendQuery(`${baseURL}${path}`, requestOptions.query);
      const token = await options.getAccessToken();
      if (!token || /[\r\n]/.test(token)) throw new TestagramApiError('A valid Testagram session is required.', 401, 'AUTH_REQUIRED');
      const id = requestId();
      const headers = new Headers(requestOptions.headers);
      // Caller-supplied headers cannot replace authentication, tracing or API version.
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
        const timer = globalThis.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
        const abort = () => controller.abort();
        if (requestOptions.signal?.aborted) controller.abort();
        else requestOptions.signal?.addEventListener('abort', abort, { once: true });
        let response: Response;
        let payload: any;
        try {
          response = await fetcher(url, {
            method,
            headers,
            body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
          });
          payload = await response.json().catch(() => null) as any;
        } catch (error) {
          if (timedOut) {
            throw new TestagramApiError('Testagram API request timed out.', 0, 'API_TIMEOUT', id);
          }
          if (requestOptions.signal?.aborted) {
            throw new TestagramApiError('Testagram API request was cancelled.', 0, 'API_ABORTED', id);
          }
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw new TestagramApiError('Testagram API request was aborted.', 0, 'API_ABORTED', id);
          }
          throw new TestagramApiError('Testagram API is unreachable.', 0, 'API_NETWORK_ERROR', id);
        } finally {
          globalThis.clearTimeout(timer);
          requestOptions.signal?.removeEventListener('abort', abort);
        }
        if (!response.ok) {
          if (method === 'GET' && attempt + 1 < attempts && [429, 502, 503, 504].includes(response.status)) {
            await new Promise(resolve => globalThis.setTimeout(resolve, retryDelay(response, attempt)));
            continue;
          }
          throw parseError(payload, response, id);
        }
        // Backend v1 endpoints return resource objects directly. Also accept the
        // standard envelope used by capability endpoints during the transition.
        if (payload && typeof payload === 'object' && typeof payload.ok === 'boolean' && 'data' in payload) {
          if (!payload.ok || payload.data == null) {
            throw new TestagramApiError(payload.error?.message || 'API returned an empty response.', response.status, payload.error?.code || 'API_EMPTY_RESPONSE', payload.request_id ?? id);
          }
          return payload.data as T;
        }
        return payload as T;
      }
      throw new TestagramApiError('Testagram API retries were exhausted.', 503, 'API_RETRIES_EXHAUSTED', id);
    },
  };
}
