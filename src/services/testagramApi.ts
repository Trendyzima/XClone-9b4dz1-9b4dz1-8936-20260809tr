import { appwriteAuth } from '@/services/appwriteAuth';
import { createTestagramApiClient } from '@/services/testagramApiClient';

const apiOrigin = (
  import.meta.env.VITE_TESTAGRAM_API_URL ??
  import.meta.env.VITE_TESTAGRAM_FRESH_API_URL ??
  import.meta.env.VITE_API_URL ??
  ''
).trim().replace(/\/+$/, '');

export const testagramApi = createTestagramApiClient({
  baseURL: apiOrigin,
  getAccessToken: async () => {
    try { return await appwriteAuth.createBackendJWT(); }
    catch { throw new Error('Your Appwrite session is unavailable. Please sign in again.'); }
  },
  defaultTimeoutMs: 10000,
  maxReadRetries: 2,
});
