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
  const message = typeof error === 'string' ? error : error?.message;
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
  const baseURL = (options.baseURL ?? '').trim().replace(/\\/+$/, '');
  const fetcher = options.fetcher ?? fetch;
  const maxReadRetries = Math.min(3, Math.max(0, options.maxReadRetries ?? 2));

  return {
    async request<T>(path: string, requestOptions: TestagramApiRequestOptions = {}): Promise<T> {
      if (!path.startsWith('/v1/') && !path.startsWith('/internal/v1/')) {
        throw new TestagramApiError('API path must be versioned.', 0, 'API_PATH_NOT_VERSIONED');
      }
      const method = requestOptions.method ?? 'GET';
      const url = appendQuery(`${baseURL}${path}`, requestOptions.query);
      const token = await options.getAccessToken();
      if (!token || /[\\r\\n]/.test(token)) throw new TestagramApiError('A valid Testagram session is required.', 401, 'AUTH_REQUIRED');
      const id = requestId();
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Request-ID': id,
        'X-Testagram-API-Version': '1',
        ...requestOptions.headers,
      };
      if (requestOptions.body !== undefined) headers['Content-Type'] = 'application/json';
      if (requestOptions.idempotencyKey) headers['Idempotency-Key'] = requestOptions.idempotencyKey;
      const attempts = method === 'GET' ? maxReadRetries + 1 : 1;

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const controller = new AbortController();
        const timeoutMs = Math.max(500, Math.min(30000, requestOptions.timeoutMs ?? options.defaultTimeoutMs ?? 10000));
        const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
        const abort = () => controller.abort();
        requestOptions.signal?.addEventListener('abort', abort, { once: true });
        let response: Response;
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
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw new TestagramApiError('Testagram API request timed out.', 0, 'API_TIMEOUT', id);
          }
          throw new TestagramApiError('Testagram API is unreachable.', 0, 'API_NETWORK_ERROR', id);
        } finally {
          globalThis.clearTimeout(timer);
          requestOptions.signal?.removeEventListener('abort', abort);
        }

        const payload = await response.json().catch(() => null) as any;
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
