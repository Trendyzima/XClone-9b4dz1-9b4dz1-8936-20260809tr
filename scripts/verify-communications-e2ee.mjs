import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const crypto = read('src/services/communicationCrypto.ts');
const service = read('src/services/communicationService.ts');
const page = read('src/pages/MessagesPage.tsx');
const migrations = fs.readdirSync('supabase/migrations').filter(name => name.includes('communication_e2ee')).map(name => read(`supabase/migrations/${name}`)).join('\n');

const required = [
  [crypto, "communication_devices').select('id')", 'canonical communication device id lookup'],
  [crypto, 'wrapConversationKey(conversationKey: CryptoKey, recipientPublicKey: string, senderCanonicalDeviceId: string)', 'canonical envelope sender identity'],
  [crypto, "testagram.communication.keys.put", 'encrypted key-envelope capability'],
  [crypto, "crypto.subtle.wrapKey('raw'", 'client-side key wrapping'],
  [crypto, "crypto.subtle.encrypt({ name: 'AES-GCM'", 'client-side message encryption'],
  [service, "testagram.messages.send_encrypted", 'ciphertext-only send capability'],
  [service, 'await this.decryptMessages(result.items ?? [])', 'client-side list decryption'],
  [service, 'testagram.messages.edit_encrypted', 'ciphertext-only edit capability'],
  [page, 'ExternalE2EEKeyProvider', 'LiveKit E2EE key provider'],
  [page, "livekit-client/e2ee-worker", 'LiveKit E2EE worker'],
  [page, 'await r.setE2EEEnabled(true)', 'LiveKit E2EE enablement'],
  [migrations, 'messages_e2ee_plaintext_guard', 'database plaintext guard'],
  [migrations, 'server_plaintext_allowed', 'server plaintext policy boundary'],
  [migrations, 'create_message_notification', 'encrypted notification trigger'],
  [migrations, 'enqueue_message_delivery', 'encrypted delivery outbox trigger'],
  [migrations, 'testagram.messages.send_encrypted', 'database capability dispatch'],
];

for (const [source, needle, label] of required) {
  if (!source.includes(needle)) throw new Error(`E2EE contract missing: ${label} (${needle})`);
}

if (crypto.includes('return device.deviceId') || crypto.includes('senderDeviceId: device.deviceId')) {
  throw new Error('E2EE contract violation: local browser deviceId is being used as canonical communication_devices.id');
}
if (/jsonb_build_object\([^;]*new\.body/s.test(migrations)) {
  throw new Error('E2EE contract violation: message plaintext body is present in a notification/delivery JSON payload');
}
if (service.includes("testagram.messages.send',") && !service.includes("testagram.messages.send_encrypted")) {
  throw new Error('E2EE send path still uses plaintext message capability');
}

console.log('communications E2EE contract: PASS');
