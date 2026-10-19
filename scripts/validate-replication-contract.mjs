import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../contracts/replication-event-v1.schema.json', import.meta.url), 'utf8'));
const migration = readFileSync(new URL('../supabase/migrations/20261019000000_dual_backend_replication.sql', import.meta.url), 'utf8');
const required = ['id', 'origin', 'entity_type', 'entity_id', 'entity_version', 'schema_version', 'event_type', 'occurred_at', 'payload'];
assert.equal(schema.type, 'object');
assert.equal(schema.additionalProperties, false);
assert.deepEqual([...schema.required].sort(), [...required].sort());

const valid = {
  id: '018f1f3a-7b2c-7abc-8def-0123456789ab',
  origin: 'xclone',
  entity_type: 'post',
  entity_id: 'post:123',
  entity_version: 1,
  schema_version: 1,
  event_type: 'post.created',
  occurred_at: '2026-10-19T00:00:00Z',
  payload: { visibility: 'public', text: 'hello' },
};

function validate(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  if (Object.keys(event).some((key) => !required.includes(key))) return false;
  if (required.some((key) => !(key in event))) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.id)) return false;
  const identity = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  if (!['origin', 'entity_type', 'entity_id', 'event_type'].every((key) => typeof event[key] === 'string' && identity.test(event[key]))) return false;
  if (!Number.isSafeInteger(event.entity_version) || event.entity_version < 1) return false;
  if (!Number.isSafeInteger(event.schema_version) || event.schema_version < 1) return false;
  if (typeof event.occurred_at !== 'string' || Number.isNaN(Date.parse(event.occurred_at))) return false;
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return false;
  if (Buffer.byteLength(JSON.stringify(event.payload)) > 1_048_576) return false;
  const forbidden = new Set(['authorization', 'access_token', 'refresh_token', 'service_role_key', 'secret_key', 'private_key', 'password', 'password_hash', 'email', 'phone', 'cookie', 'session', 'api_key', 'signed_url', 'presigned_url', 'upload_url']);
  const hasSecret = (value) => {
    if (Array.isArray(value)) return value.some(hasSecret);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => forbidden.has(key.toLowerCase().replace(/[- ]/g, '_')) || hasSecret(child));
  };
  return !hasSecret(event.payload);
}

assert.equal(validate(valid), true, 'valid event should pass');
assert.equal(validate({ ...valid, entity_version: 0 }), false, 'non-positive entity version should fail');
assert.equal(validate({ ...valid, unexpected: true }), false, 'unknown envelope fields should fail');
assert.equal(validate({ ...valid, payload: { signed_url: 'https://example.invalid/?token=secret' } }), false, 'signed URLs must not be replicated');

for (const requiredSQL of [
  'platform_replication_outbox',
  'platform_replication_inbox',
  'platform_replication_entity_versions',
  'platform_replication_projection',
  'lease_token UUID',
  'failed_at TIMESTAMPTZ',
  'enqueue_platform_replication_event',
  'apply_platform_replication_pending',
  'fail_platform_replication_event',
  'GRANT EXECUTE ON FUNCTION public.enqueue_platform_replication_event(JSONB) TO service_role',
  'GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role',
]) {
  assert.ok(migration.includes(requiredSQL), `replication migration is missing: ${requiredSQL}`);
}

for (const forbiddenKey of ['email', 'phone', 'password_hash', 'private_key', 'api_key']) {
  assert.equal(
    validate({ ...valid, payload: { [forbiddenKey]: 'should-not-cross-backends' } }),
    false,
    `forbidden payload key ${forbiddenKey} should fail`,
  );
}

console.log('Dual-backend replication contract validation passed.');
