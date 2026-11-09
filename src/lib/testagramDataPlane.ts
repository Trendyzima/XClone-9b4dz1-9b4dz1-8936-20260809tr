import { testagramApiRequest, type TestagramApiRequest } from '@/services/apiClient';

/**
 * Canonical XClone data-plane facade.
 *
 * Replacement seam for legacy browser database clients. It exposes Backend
 * HTTP resource operations only: no query builder, SQL/PostgREST access,
 * SDK fallback, or client-side persistence.
 *
 * Authenticated calls inherit the Appwrite -> Backend JWT contract from
 * testagramApiRequest. Public reads must opt in explicitly per request.
 */
export type DataPlaneMethod = NonNullable<TestagramApiRequest['method']>;
export type DataPlaneOptions = Omit<TestagramApiRequest, 'method'>;

const ALLOWED_PREFIXES = ['/api/', '/v1/'];

function normalizeResourcePath(path: string): string {
  const value = path.trim();
  const rawPath = value.split('?', 1)[0];
  if (
    !value ||
    value.includes('\\') ||
    value.includes('#') ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    !ALLOWED_PREFIXES.some((prefix) => rawPath.startsWith(prefix))
  ) {
    throw new TypeError('A valid relative Backend API resource path is required.');
  }

  // Check the un-normalized path before URL parsing: URL() silently resolves
  // dot segments, which would otherwise hide traversal attempts.
  const segments = rawPath.split('/');
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new TypeError('Data-plane resource paths must use valid URL encoding.');
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/')) {
      throw new TypeError('Data-plane resource paths must not contain traversal segments.');
    }
  }

  const url = new URL(value, 'https://testagram.invalid');
  if (
    url.origin !== 'https://testagram.invalid' ||
    !ALLOWED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  ) {
    throw new TypeError('Data-plane requests must target a supported /api or /v1 resource.');
  }
  return url.pathname + url.search;
}

async function request<T>(method: DataPlaneMethod, path: string, options: DataPlaneOptions = {}): Promise<T> {
  return testagramApiRequest<T>(normalizeResourcePath(path), { ...options, method });
}

export const testagramDataPlane = Object.freeze({
  request,
  get<T>(path: string, options?: DataPlaneOptions) {
    return request<T>('GET', path, options);
  },
  post<T>(path: string, body?: unknown, options?: DataPlaneOptions) {
    return request<T>('POST', path, { ...options, body });
  },
  put<T>(path: string, body?: unknown, options?: DataPlaneOptions) {
    return request<T>('PUT', path, { ...options, body });
  },
  patch<T>(path: string, body?: unknown, options?: DataPlaneOptions) {
    return request<T>('PATCH', path, { ...options, body });
  },
  delete<T>(path: string, options?: DataPlaneOptions) {
    return request<T>('DELETE', path, options);
  },
});

export { TestagramApiError } from '@/services/apiClient';
