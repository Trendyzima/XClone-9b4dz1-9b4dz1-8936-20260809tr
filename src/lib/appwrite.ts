import { Account, Client } from 'appwrite';

const endpointValue = import.meta.env.VITE_APPWRITE_ENDPOINT?.trim() ?? '';
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID?.trim() ?? '';

function validateEndpoint(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('VITE_APPWRITE_ENDPOINT must be an absolute Appwrite API URL ending in /v1.');
  }

  const localHTTP =
    parsed.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  if (
    (parsed.protocol !== 'https:' && !localHTTP) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.pathname.replace(/\/$/, '').endsWith('/v1')
  ) {
    throw new Error(
      'VITE_APPWRITE_ENDPOINT must use HTTPS and end in /v1 (HTTP is permitted only for localhost).',
    );
  }
  return parsed.toString().replace(/\/$/, '');
}

export const isAppwriteAuthConfigured = Boolean(endpointValue && projectId);

export const appwriteClient = new Client();
if (isAppwriteAuthConfigured) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) {
    throw new Error('VITE_APPWRITE_PROJECT_ID is invalid.');
  }
  appwriteClient.setEndpoint(validateEndpoint(endpointValue)).setProject(projectId);
}

export const appwriteAccount = new Account(appwriteClient);

export function assertAppwriteAuthConfigured(): void {
  if (!isAppwriteAuthConfigured) {
    throw new Error(
      'Appwrite authentication is not configured. Set VITE_APPWRITE_ENDPOINT and VITE_APPWRITE_PROJECT_ID in the frontend build environment.',
    );
  }
}
