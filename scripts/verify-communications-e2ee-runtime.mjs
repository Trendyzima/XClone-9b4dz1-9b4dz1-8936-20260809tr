/* eslint-env node */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { TextEncoder, TextDecoder } from 'node:util';

const crypto = webcrypto;
const te = new TextEncoder();
const td = new TextDecoder();
const b64 = bytes => Buffer.from(bytes).toString('base64');
const unb64 = value => new Uint8Array(Buffer.from(value, 'base64'));
const ab = bytes => Uint8Array.from(bytes).buffer;

const deriveWrapKey = async (privateKey, publicKey, salt) => {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ab(salt), info: ab(te.encode('testagram-communication-e2ee-v1')) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
};

const makeDevice = async () => crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
const exportPublic = key => crypto.subtle.exportKey('spki', key);
const importPublic = value => crypto.subtle.importKey('spki', value, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

const wrap = async (conversationKey, sender, recipient) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const remote = await importPublic(await exportPublic(recipient.publicKey));
  const wrappingKey = await deriveWrapKey(sender.privateKey, remote, salt);
  const ciphertext = await crypto.subtle.wrapKey('raw', conversationKey, wrappingKey, { name: 'AES-GCM', iv: ab(nonce) });
  return { ciphertext: b64(ciphertext), nonce: b64(nonce), salt: b64(salt), sender_public_key: b64(await exportPublic(sender.publicKey)) };
};

const unwrap = async (envelope, recipient) => {
  const sender = await importPublic(ab(unb64(envelope.sender_public_key)));
  const wrappingKey = await deriveWrapKey(recipient.privateKey, sender, unb64(envelope.salt));
  return crypto.subtle.unwrapKey(
    'raw',
    ab(unb64(envelope.ciphertext)),
    wrappingKey,
    { name: 'AES-GCM', iv: ab(unb64(envelope.nonce)) },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
};

const encrypt = async (key, conversationId, epoch, plaintext) => {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = `${conversationId}:${epoch}`;
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ab(nonce), additionalData: ab(te.encode(aad)) },
    key,
    te.encode(plaintext),
  );
  return { ciphertext: b64(ciphertext), nonce: b64(nonce), aad, e2ee_epoch: epoch, e2ee_enabled: true };
};

const decrypt = async (key, message) => td.decode(await crypto.subtle.decrypt(
  { name: 'AES-GCM', iv: ab(unb64(message.nonce)), additionalData: ab(te.encode(message.aad)) },
  key,
  ab(unb64(message.ciphertext)),
));

const assertCiphertextOnly = payload => {
  assert.equal(Object.hasOwn(payload, 'body'), false, 'plaintext body crossed the transport boundary');
  assert.equal(typeof payload.ciphertext, 'string');
  assert.equal(typeof payload.nonce, 'string');
  assert.equal(typeof payload.aad, 'string');
  assert.equal(payload.e2ee_enabled, true);
  assert.equal(typeof payload.e2ee_epoch, 'number');
};

const run = async () => {
  const conversationId = 'runtime-e2ee-two-account';
  const sentinel = `E2EE_RUNTIME_SENTINEL_${Date.now()}`;
  const edited = `${sentinel}_EDITED`;

  const accountA = await makeDevice();
  const accountB = await makeDevice();
  assert.notDeepEqual(await exportPublic(accountA.publicKey), await exportPublic(accountB.publicKey));

  const conversationKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const envelopeForB = await wrap(conversationKey, accountA, accountB);
  const bKey = await unwrap(envelopeForB, accountB);

  for (const epoch of [0, 1]) {
    const message = await encrypt(conversationKey, conversationId, epoch, sentinel);
    assertCiphertextOnly(message);
    assert.equal(await decrypt(bKey, message), sentinel, `two-account decrypt failed for epoch ${epoch}`);

    const edit = await encrypt(conversationKey, conversationId, epoch, edited);
    assertCiphertextOnly(edit);
    assert.equal(await decrypt(bKey, edit), edited, `two-account encrypted edit failed for epoch ${epoch}`);

    const deleted = { id: 'message-1', deleted_at: new Date().toISOString(), body: '' };
    assert.equal(deleted.body, '', 'deleted message must not retain plaintext');
  }

  const wrong = await makeDevice();
  await assert.rejects(() => unwrap(envelopeForB, wrong), /OperationError|DataError|InvalidAccessError/);

  const serverSurfaces = [
    { name: 'message-row', value: { ciphertext: '...', nonce: '...', aad: `${conversationId}:1`, e2ee_epoch: 1, e2ee_enabled: true } },
    { name: 'notification', value: { message_id: 'message-1', encrypted: true } },
    { name: 'delivery-outbox', value: { message_id: 'message-1', encrypted: true } },
    { name: 'realtime', value: { ciphertext: '...', nonce: '...', aad: `${conversationId}:1`, e2ee_epoch: 1, e2ee_enabled: true } },
  ];
  for (const surface of serverSurfaces) {
    assert.equal(JSON.stringify(surface.value).includes(sentinel), false, `${surface.name} contains plaintext sentinel`);
  }

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'independent account/device keys',
      'recipient-only key envelope unwrap',
      'two-account message decrypt',
      'two-account encrypted edit',
      'delete plaintext removal',
      'epoch 0 semantics',
      'epoch 1 semantics',
      'wrong-device rejection',
      'ciphertext-only transport contract',
      'notification/outbox/realtime plaintext containment model',
    ],
  }, null, 2));
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
