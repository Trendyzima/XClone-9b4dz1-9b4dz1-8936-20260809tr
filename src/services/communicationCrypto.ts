import { supabase } from '@/lib/supabase';
import { backendCapabilities } from '@/services/testagramCapabilityClient';

const DB_NAME = 'testagram-communication-crypto';
const STORE = 'devices';
const KEY_STORE = 'conversationKeys';
const DB_VERSION = 2;
const DEVICE_ID_KEY = 'testagram.communication.device_id';
const INFO = new TextEncoder().encode('testagram-communication-e2ee-v1');

export type CommunicationDevice = {
  id: string;
  user_id: string;
  device_id: string;
  identity_public_key: string;
};

type StoredDevice = { deviceId: string; privateKey: CryptoKey; publicKey: CryptoKey };
type StoredConversationKey = { keyId: string; conversationId: string; epoch: number; key: CryptoKey };

const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'deviceId' });
    if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE, { keyPath: 'keyId' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Unable to open crypto storage'));
});

const read = <T>(store: string, key: IDBValidKey) => openDb().then(db => new Promise<T | null>((resolve, reject) => {
  const request = db.transaction(store, 'readonly').objectStore(store).get(key);
  request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
  request.onerror = () => reject(request.error ?? new Error('Unable to read crypto storage'));
}));

const write = <T>(store: string, value: T) => openDb().then(db => new Promise<void>((resolve, reject) => {
  const request = db.transaction(store, 'readwrite').objectStore(store).put(value);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error ?? new Error('Unable to write crypto storage'));
}));

const getLocalDeviceId = () => {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_ID_KEY, id); }
  return id;
};

const ensureDevice = async (): Promise<StoredDevice> => {
  const deviceId = getLocalDeviceId();
  const existing = await read<StoredDevice>(STORE, deviceId);
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const device: StoredDevice = { deviceId, privateKey: pair.privateKey, publicKey: pair.publicKey };
  await write(STORE, device);
  return device;
};

const toArrayBuffer = (bytes: Uint8Array) => { const copy = new Uint8Array(bytes.byteLength); copy.set(bytes); return copy.buffer; };
const encode = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const exportPublicKey = async (key: CryptoKey) => encode(await crypto.subtle.exportKey('spki', key));
const importPublicKey = async (encoded: string) => crypto.subtle.importKey('spki', toArrayBuffer(decode(encoded)), { name: 'ECDH', namedCurve: 'P-256' }, false, []);

const deriveWrappingKey = async (privateKey: CryptoKey, publicKey: CryptoKey, salt: Uint8Array) => {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: toArrayBuffer(salt), info: toArrayBuffer(INFO) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};

const importConversationKey = (raw: ArrayBuffer) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const keyId = (conversationId: string, epoch: number) => `${conversationId}:${epoch}`;

const readConversationKey = (conversationId: string, epoch: number) => read<StoredConversationKey>(KEY_STORE, keyId(conversationId, epoch));
const storeConversationKey = async (conversationId: string, epoch: number, raw: ArrayBuffer) => {
  const key = await importConversationKey(raw);
  await write(KEY_STORE, { keyId: keyId(conversationId, epoch), conversationId, epoch, key } satisfies StoredConversationKey);
  return key;
};

export const communicationCrypto = {
  async registerDevice(): Promise<{ id: string; deviceId: string; publicKey: string }> {
    const device = await ensureDevice();
    const publicKey = await exportPublicKey(device.publicKey);
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user.id;
    if (!userId) throw new Error('Authentication required');
    const { error } = await supabase.from('communication_devices').upsert({ user_id: userId, device_id: device.deviceId, identity_public_key: publicKey, last_seen_at: new Date().toISOString(), revoked_at: null }, { onConflict: 'user_id,device_id' });
    if (error) throw error;
    const { data, error: readError } = await supabase.from('communication_devices').select('id').eq('user_id', userId).eq('device_id', device.deviceId).is('revoked_at', null).single();
    if (readError || !data?.id) throw readError ?? new Error('Canonical communication device id unavailable');
    return { id: String(data.id), deviceId: device.deviceId, publicKey };
  },

  async listConversationDevices(conversationId: string) {
    return backendCapabilities.call<{ devices: CommunicationDevice[] }>('testagram.communication.devices.list', { conversation_id: conversationId });
  },

  async listMyKeyEnvelopes(conversationId: string) {
    return backendCapabilities.call<{ envelopes: Array<{ id: string; conversation_id: string; epoch: number; sender_device_id: string; recipient_device_id: string; ciphertext: string; nonce: string; salt: string; sender_public_key: string }> }>('testagram.communication.keys.list', { conversation_id: conversationId });
  },

  async putKeyEnvelope(input: { conversationId: string; epoch: number; senderDeviceId: string; recipientDeviceId: string; ciphertext: string; nonce: string; salt: string }) {
    return backendCapabilities.call<{ envelope_id: string }>('testagram.communication.keys.put', { conversation_id: input.conversationId, epoch: input.epoch, sender_device_id: input.senderDeviceId, recipient_device_id: input.recipientDeviceId, ciphertext: input.ciphertext, nonce: input.nonce, salt: input.salt });
  },

  async createConversationKey() { return toArrayBuffer(crypto.getRandomValues(new Uint8Array(32))); },

  async wrapConversationKey(conversationKey: ArrayBuffer, recipientPublicKey: string, senderCanonicalDeviceId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(senderCanonicalDeviceId)) throw new Error('Canonical communication_devices.id required');
    const device = await ensureDevice();
    const remote = await importPublicKey(recipientPublicKey);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const wrappingKey = await deriveWrappingKey(device.privateKey, remote, salt);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(nonce) }, wrappingKey, conversationKey);
    return { ciphertext: encode(ciphertext), nonce: encode(toArrayBuffer(nonce)), salt: encode(toArrayBuffer(salt)), senderDeviceId: senderCanonicalDeviceId };
  },

  async unwrapConversationKey(envelope: { ciphertext: string; nonce: string; salt: string; senderPublicKey: string }) {
    const device = await ensureDevice();
    const sender = await importPublicKey(envelope.senderPublicKey);
    const wrappingKey = await deriveWrappingKey(device.privateKey, sender, decode(envelope.salt));
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(decode(envelope.nonce)) }, wrappingKey, toArrayBuffer(decode(envelope.ciphertext)));
  },

  async ensureConversationKey(conversationId: string) {
    const local = await this.registerDevice();
    const envelopes = await this.listMyKeyEnvelopes(conversationId);
    const existing = envelopes.envelopes.sort((a, b) => b.epoch - a.epoch).find(x => x.recipient_device_id === local.id);
    if (existing) {
      const cached = await readConversationKey(conversationId, existing.epoch);
      if (cached) return { epoch: existing.epoch, key: cached.key };
      const raw = await this.unwrapConversationKey(existing);
      const key = await storeConversationKey(conversationId, existing.epoch, raw);
      return { epoch: existing.epoch, key };
    }

    const devices = (await this.listConversationDevices(conversationId)).devices;
    if (!devices.some(d => d.id === local.id)) throw new Error('Local device is not registered in this conversation');
    if (envelopes.envelopes.length > 0) throw new Error('Conversation key exists but is not distributed to this device');
    const conversationKey = await this.createConversationKey();
    const epoch = 1;
    for (const recipient of devices) {
      const envelope = await this.wrapConversationKey(conversationKey, recipient.identity_public_key, local.id);
      await this.putKeyEnvelope({ conversationId, epoch, senderDeviceId: local.id, recipientDeviceId: recipient.id, ...envelope });
    }
    const key = await storeConversationKey(conversationId, epoch, conversationKey);
    return { epoch, key };
  },

  async encryptMessage(conversationId: string, plaintext: string) {
    const { epoch, key } = await this.ensureConversationKey(conversationId);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(nonce) }, key, new TextEncoder().encode(plaintext));
    return { epoch, ciphertext: encode(ciphertext), nonce: encode(toArrayBuffer(nonce)) };
  },

  async decryptMessage(conversationId: string, epoch: number, ciphertext: string, nonce: string) {
    const { key } = await this.ensureConversationKey(conversationId);
    if (!key) throw new Error('Conversation key unavailable');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(decode(nonce)) }, key, toArrayBuffer(decode(ciphertext)));
    return new TextDecoder().decode(plaintext);
  },
};
