import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../contracts/replication-event-v1.schema.json', import.meta.url), 'utf8'));
const migration = readFileSync(new URL('../supabase/migrations/20261019000000_dual_backend_replication.sql', import.meta.url), 'utf8');
const producerMigration = readFileSync(new URL('../supabase/migrations/20261019010000_replication_source_producers.sql', import.meta.url), 'utf8');
const sharedContract = readFileSync(new URL('../supabase/functions/_shared/replication-contract.ts', import.meta.url), 'utf8');
const receiverSource = readFileSync(new URL('../supabase/functions/replication-receiver/index.ts', import.meta.url), 'utf8');
const relaySource = readFileSync(new URL('../supabase/functions/replication-relay/index.ts', import.meta.url), 'utf8');
const parityMigration = readFileSync(new URL('../supabase/migrations/20261019020000_replication_sensitive_key_parity.sql', import.meta.url), 'utf8');

const migrationLines = migration.split(/\r?\n/);
assert.equal(migrationLines.filter((line) => line.trim() === 'BEGIN;').length, 1, 'replication migration must have one transaction start');
assert.equal(migrationLines.filter((line) => line.trim() === 'COMMIT;').length, 1, 'replication migration must have one transaction end');
const migrationCommitOffset = migration.lastIndexOf('\nCOMMIT;');
assert.ok(migrationCommitOffset >= 0, 'replication migration must terminate with COMMIT');
assert.equal(migration.slice(migrationCommitOffset + '\nCOMMIT;'.length).trim(), '', 'no SQL may remain after the transaction terminator');
const parityMigrationLines = parityMigration.split(/\r?\n/);
assert.equal(parityMigrationLines.filter((line) => line.trim() === 'BEGIN;').length, 1, 'parity migration must have one transaction start');
assert.equal(parityMigrationLines.filter((line) => line.trim() === 'COMMIT;').length, 1, 'parity migration must have one transaction end');
const parityCommitOffset = parityMigration.lastIndexOf('\nCOMMIT;');
assert.ok(parityCommitOffset >= 0, 'parity migration must terminate with COMMIT');
assert.equal(parityMigration.slice(parityCommitOffset + '\nCOMMIT;'.length).trim(), '', 'no SQL may remain after the parity transaction terminator');
assert.ok(migration.includes('SELECT count(*) INTO event_field_count FROM jsonb_object_keys(p_event)'), 'event envelope field count must use supported JSONB functions');

assert.ok(
  migration.includes('tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned'),
  'a tombstone must remain terminal when newer events are applied',
);
assert.ok(
  migration.includes('AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)'),
  'non-delete events must not resurrect a tombstoned entity',
);
assert.ok(
  producerMigration.includes("IF was_public AND NOT is_public THEN"),
  'public-to-private profile transitions must emit a tombstone',
);


const required = ['id', 'origin', 'entity_type', 'entity_id', 'entity_version', 'schema_version', 'event_type', 'occurred_at', 'payload'];
assert.equal(schema.type, 'object');
assert.equal(schema.additionalProperties, false);
assert.equal(schema.properties.schema_version.const, 1, 'event v1 contract must pin schema_version to 1');
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
  if (!event.event_type.toLowerCase().startsWith(event.entity_type.toLowerCase() + '.')) return false;
  if (!Number.isSafeInteger(event.entity_version) || event.entity_version < 1) return false;
  if (event.schema_version !== 1) return false;
  if (typeof event.occurred_at !== 'string' ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/.test(event.occurred_at) ||
      Number.isNaN(Date.parse(event.occurred_at))) return false;
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return false;
  if (Buffer.byteLength(JSON.stringify(event.payload)) > 1_048_576) return false;
  if (Buffer.byteLength(JSON.stringify(event)) > 1_048_576) return false;
  const forbidden = new Set([
    'authorization', 'access_token', 'refresh_token', 'token', 'bearer', 'jwt',
    'service_role', 'service_role_key', 'secret_key', 'secret', 'private_key', 'credential', 'credentials',
    'password', 'password_hash', 'passwd', 'email', 'email_address', 'phone', 'phone_number',
    'cookie', 'session', 'api_key', 'signed_url', 'presigned_url', 'upload_url',
  ]);
  const normalizeKey = (key) => key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();
  const hasSecret = (value) => {
    if (Array.isArray(value)) return value.some(hasSecret);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => {
      const normalized = normalizeKey(key);
      if ([...forbidden].some((fragment) => normalized.includes(fragment))) return true;
      if (normalized.endsWith('_url') && typeof child === 'string' &&
        (child.includes('?') || child.includes('#') || /:\/\/[^/]*@/.test(child))) return true;
      return hasSecret(child);
    });
  };
  return !hasSecret(event.payload);
}

assert.equal(validate(valid), true, 'valid event should pass');
assert.equal(validate({ ...valid, entity_version: 0 }), false, 'non-positive entity version should fail');
assert.equal(validate({ ...valid, schema_version: 2 }), false, 'unsupported schema version should fail');
assert.equal(validate({ ...valid, event_type: 'account.created' }), false, 'event type must match entity type');
assert.equal(validate({ ...valid, occurred_at: '2026-10-19 00:00:00Z' }), false, 'timestamp must be RFC3339');
assert.equal(validate({ ...valid, payload: { blob: 'x'.repeat(1_048_500) } }), false, 'oversized full envelope should fail');
assert.equal(validate({ ...valid, unexpected: true }), false, 'unknown envelope fields should fail');
assert.equal(validate({ ...valid, payload: { signed_url: 'https://example.invalid/?token=secret' } }), false, 'signed URLs must not be replicated');
assert.equal(validate({ ...valid, payload: { avatar_url: 'https://cdn.example/avatar?token=secret' } }), false, 'signed URL-valued fields must not be replicated');

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
  "regexp_replace(key_name, '([a-z0-9])([A-Z])', '\\1_\\2', 'g')",
  'position(forbidden_key.value in normalized_key) > 0',
]) {
  assert.ok(migration.includes(requiredSQL), `replication migration is missing: ${requiredSQL}`);
}

for (const requiredSharedContract of [
  'MAX_REPLICATION_BODY_BYTES = 1_048_576',
  'event.schema_version !== 1',
  'eventType.toLowerCase().startsWith(entityType.toLowerCase() + ".")',
  'RFC3339',
  'FORBIDDEN_FRAGMENTS',
  'normalized.endsWith("_url")',
]) {
  assert.ok(sharedContract.includes(requiredSharedContract), `shared replication contract is missing: ${requiredSharedContract}`);
}
assert.ok(receiverSource.includes('isValidReplicationEvent(event)'), 'receiver must use shared event validation');
assert.ok(relaySource.includes('isValidReplicationEvent(event)'), 'relay must use shared event validation');

for (const requiredParitySQL of [
  "IF octet_length(p_event::text) > 1048576 THEN",
  "schema_version_value <> 1",
  "left(lower(event_type_value), length(entity_type_value) + 1)",
  "'bearer','jwt'",
  "'password_hash','passwd','email','email_address'",
  "'private_key','service_role','service_role_key'",
  "CREATE OR REPLACE FUNCTION public.platform_replication_has_forbidden_key(p_value JSONB)",
  "CREATE OR REPLACE FUNCTION public.enforce_replication_media_size_limit()",
  "size_text::BIGINT > 524288000",
  "GRANT EXECUTE ON FUNCTION public.enforce_replication_media_size_limit() TO service_role",
]) {
  assert.ok(parityMigration.includes(requiredParitySQL), `replication parity migration is missing: ${requiredParitySQL}`);
}

for (const requiredProducerSQL of [
  'platform_replication_source_versions',
  'replicate_public_post_after_write',
  'replicate_public_profile_after_write',
  'seed_platform_replication_public_snapshot',
  'enqueue_public_post_replication_event',
  'enqueue_public_profile_replication_event',
  'public.enqueue_platform_replication_event',
  'AFTER INSERT OR DELETE ON public.posts',
  'AFTER UPDATE OF content, body, visibility, community_id, author_id, user_id, deleted_at ON public.posts',
  'AFTER INSERT OR DELETE ON public.profiles',
  'AFTER UPDATE OF account_status, discoverable_by_username, protected_account, username, display_name, bio, avatar_url ON public.profiles',
  "AND NOT coalesce((old_row->>'protected_account')::boolean, FALSE)",
  "AND NOT coalesce((new_row->>'protected_account')::boolean, FALSE)",
  'AND NOT coalesce(p.protected_account, FALSE)',
]) {
  assert.ok(producerMigration.includes(requiredProducerSQL), `source producer migration is missing: ${requiredProducerSQL}`);
}

for (const forbiddenKey of [
  'email', 'phone', 'password_hash', 'private_key', 'api_key',
  'accessToken', 'refresh-token', 'PasswordHash', 'private.key',
  'serviceRoleKey', 'signedURL', 'presigned-url', 'phone number',
  'providerCredentials', 'customerEmail', 'jwtToken', 'serviceRole', 'bearer', 'jwt', 'passwd',
]) {
  assert.equal(
    validate({ ...valid, payload: { [forbiddenKey]: 'should-not-cross-backends' } }),
    false,
    `forbidden payload key variant ${forbiddenKey} should fail`,
  );
}
assert.equal(
  validate({ ...valid, payload: { metadata: [{ nestedSecret: { serviceRoleKey: 'never-export' } }] } }),
  false,
  'sensitive keys nested in arrays and objects must be rejected',
);

console.log('Dual-backend replication contract validation passed.');
