export const MAX_REPLICATION_BODY_BYTES = 1_048_576;

const encoder = new TextEncoder();
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339 = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/;
const FORBIDDEN_FRAGMENTS = [
  "authorization", "access_token", "refresh_token", "token", "bearer", "jwt",
  "service_role", "secret", "private_key", "password", "passwd", "email", "phone",
  "credential", "cookie", "session", "api_key", "signed_url", "presigned_url", "upload_url",
];

export type ReplicationEventV1 = {
  id: string;
  origin: string;
  entity_type: string;
  entity_id: string;
  entity_version: number;
  schema_version: 1;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
};

function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
}

export function hasSensitiveReplicationKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSensitiveReplicationKey);
  if (!value || typeof value !== "object") return false;

  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = normalizeKey(key);
    if (FORBIDDEN_FRAGMENTS.some((fragment) => normalized.includes(fragment))) return true;
    if (normalized.endsWith("_url") && typeof child === "string" &&
      (child.includes("?") || child.includes("#") || /:\/\/[^/]*@/.test(child))) return true;
    return hasSensitiveReplicationKey(child);
  });
}

export function isValidReplicationEvent(value: unknown): value is ReplicationEventV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const required = [
    "id", "origin", "entity_type", "entity_id", "entity_version",
    "schema_version", "event_type", "occurred_at", "payload",
  ];

  if (Object.keys(event).some((key) => !required.includes(key)) ||
    required.some((key) => !(key in event))) return false;
  if (typeof event.id !== "string" || !UUID.test(event.id)) return false;
  if (!["origin", "entity_type", "entity_id", "event_type"].every((key) =>
    typeof event[key] === "string" && IDENTITY.test(event[key] as string))) return false;
  if (!Number.isSafeInteger(event.entity_version) || (event.entity_version as number) < 1) return false;
  if (event.schema_version !== 1) return false;

  const entityType = event.entity_type as string;
  const eventType = event.event_type as string;
  if (!eventType.toLowerCase().startsWith(entityType.toLowerCase() + ".")) return false;
  if (typeof event.occurred_at !== "string" || !RFC3339.test(event.occurred_at) ||
    !Number.isFinite(Date.parse(event.occurred_at))) return false;

  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (encoder.encode(JSON.stringify(payload)).byteLength > MAX_REPLICATION_BODY_BYTES) return false;
  if (encoder.encode(JSON.stringify(event)).byteLength > MAX_REPLICATION_BODY_BYTES) return false;
  if (hasSensitiveReplicationKey(payload)) return false;
  return true;
}
