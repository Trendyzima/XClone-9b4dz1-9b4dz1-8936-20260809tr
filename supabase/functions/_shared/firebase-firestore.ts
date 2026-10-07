const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_BASE = "https://firestore.googleapis.com/v1";

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

const b64url = (bytes: Uint8Array) =>
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/\\//g, "_")
    .replace(/=+$/g, "");

const textB64url = (value: string) =>
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");

const pemToDer = (pem: string) => {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\s/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
};

const loadServiceAccount = (): ServiceAccount => {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "";
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  const parsed = JSON.parse(raw);
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is incomplete.");
  }
  return parsed;
};

const accessToken = async () => {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = textB64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = textB64url(JSON.stringify({
    iss: sa.client_email,
    scope: FIRESTORE_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
  );
  const assertion = `${unsigned}.${b64url(signature)}`;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || "Firebase service-account authentication failed.");
  }
  cachedToken = {
    value: String(payload.access_token),
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
  };
  return cachedToken.value;
};

const firestoreUrl = (collection: string, id: string) => {
  const sa = loadServiceAccount();
  return `${FIRESTORE_BASE}/projects/${encodeURIComponent(sa.project_id)}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`;
};

const value = (v: unknown): Record<string, unknown> => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number" && Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === "number") return { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  return { stringValue: JSON.stringify(v) };
};

const fields = (record: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(record).map(([k, v]) => [k, value(v)]));

export async function upsertFirebaseLiveMetadata(
  streamId: string,
  metadata: Record<string, unknown>,
) {
  const token = await accessToken();
  const response = await fetch(firestoreUrl("tv_live_streams", streamId), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: fields(metadata) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || `Firebase Firestore write failed (${response.status}).`);
  }
}

export async function deleteFirebaseLiveMetadata(streamId: string) {
  const token = await accessToken();
  const response = await fetch(firestoreUrl("tv_live_streams", streamId), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || `Firebase Firestore delete failed (${response.status}).`);
  }
}

export async function getFirebaseLiveMetadata(streamId: string): Promise<Record<string, unknown> | null> {
  const token = await accessToken();
  const response = await fetch(firestoreUrl("tv_live_streams", streamId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || `Firebase Firestore read failed (${response.status}).`);
  const out: Record<string, unknown> = {};
  for (const [key, wrapped] of Object.entries(payload?.fields || {})) {
    const v = wrapped as Record<string, unknown>;
    out[key] = v.stringValue ?? v.integerValue ?? v.doubleValue ?? v.booleanValue ?? v.timestampValue ?? v.nullValue ?? null;
  }
  return out;
}
