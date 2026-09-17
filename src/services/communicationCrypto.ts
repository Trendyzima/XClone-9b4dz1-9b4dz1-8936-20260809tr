import { supabase } from '@/lib/supabase';

const DB_NAME = 'testagram-communication-crypto';
const STORE = 'devices';
const DEVICE_ID_KEY = 'testagram.communication.device_id';

type StoredDevice = {
  deviceId: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
};

const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'deviceId' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Unable to open crypto storage'));
});

const readDevice = async (deviceId: string): Promise<StoredDevice | null> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(deviceId);
    request.onsuccess = () => resolve((request.result as StoredDevice | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Unable to read crypto device'));
  });
};

const writeDevice = async (device: StoredDevice) => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(device);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Unable to store crypto device'));
  });
};

const getDeviceId = () => {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
};

const ensureDevice = async (): Promise<StoredDevice> => {
  const deviceId = getDeviceId();
  const existing = await readDevice(deviceId);
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits'],
  );
  const device: StoredDevice = { deviceId, privateKey: pair.privateKey, publicKey: pair.publicKey };
  await writeDevice(device);
  return device;
};

const exportPublicKey = async (key: CryptoKey) => {
  const raw = await crypto.subtle.exportKey('spki', key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
};

const importPublicKey = async (encoded: string) => {
  const raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  return crypto.subtle.importKey('spki', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
};

const deriveWrappingKey = async (privateKey: CryptoKey, publicKey: CryptoKey, salt: Uint8Array) => {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('testagram-communication-e2ee-v1') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

const encode = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));

export const communicationCrypto = {
  async registerDevice() {
    const device = await ensureDevice();
    const identityPublicKey = await exportPublicKey(device.publicKey);
    const { data: session } = await supabase.auth.getSession();
    if (!session.session?.user.id) throw new Error('Authentication required');
    const { error } = await supabase.from('communication_devices').upsert({
      user_id: session.session.user.id,
      device_id: device.deviceId,
      identity_public_key: identityPublicKey,
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: 'user_id,device_id' });
    if (error) throw error;
    return { id: device.deviceId, publicKey: identityPublicKey };
  },

  async createConversationKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return bytes.buffer;
  },

  async wrapConversationKey(conversationKey: ArrayBuffer, recipientPublicKey: string) {
    const device = await ensureDevice();
    const remote = await importPublicKey(recipientPublicKey);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const wrappingKey = await deriveWrappingKey(device.privateKey, remote, salt);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, wrappingKey, conversationKey);
    return { ciphertext: encode(ciphertext), nonce: encode(nonce), salt: encode(salt), senderDeviceId: device.deviceId };
  },

  async unwrapConversationKey(envelope: { ciphertext: string; nonce: string; salt: string; senderPublicKey: string }) {
    const device = await ensureDevice();
    const sender = await importPublicKey(envelope.senderPublicKey);
    const wrappingKey = await deriveWrappingKey(device.privateKey, sender, decode(envelope.salt));
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.nonce) }, wrappingKey, decode(envelope.ciphertext));
  },
};
