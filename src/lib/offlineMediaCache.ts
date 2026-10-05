const CACHE_NAME = 'testagram-offline-media-v1';
const META_DB = 'testagram-offline-media-meta-v1';
const META_STORE = 'entries';
const MAX_VIDEOS = 8;
const MIN_VIDEOS = 5;
const MAX_IMAGES = 24;
const MAX_TOTAL_BYTES = 160 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

type MediaKind = 'video' | 'image';
type Meta = { url: string; kind: MediaKind; bytes: number; lastUsed: number };

function available() {
  return typeof window !== 'undefined' && typeof caches !== 'undefined' && typeof fetch === 'function';
}

function kindFor(url: string, response?: Response): MediaKind {
  const type = response?.headers.get('content-type')?.toLowerCase() ?? '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  const clean = url.split('?')[0].split('#')[0].toLowerCase();
  return /\.(jpe?g|png|gif|webp|avif|svg)$/.test(clean) ? 'image' : 'video';
}

function openMetaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(META_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(META_STORE, { keyPath: 'url' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getMeta(url: string): Promise<Meta | null> {
  try {
    const db = await openMetaDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(META_STORE).objectStore(META_STORE).get(url);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

async function putMeta(meta: Meta) {
  try {
    const db = await openMetaDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

async function allMeta(): Promise<Meta[]> {
  try {
    const db = await openMetaDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(META_STORE).objectStore(META_STORE).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
}

async function deleteMeta(url: string) {
  try {
    const db = await openMetaDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).delete(url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

async function trimCache() {
  const cache = await caches.open(CACHE_NAME);
  const entries = await allMeta();
  let total = entries.reduce((sum, entry) => sum + Math.max(0, entry.bytes), 0);
  const videos = entries.filter(e => e.kind === 'video').sort((a, b) => a.lastUsed - b.lastUsed);
  const images = entries.filter(e => e.kind === 'image').sort((a, b) => a.lastUsed - b.lastUsed);
  const remove: Meta[] = [];

  while (videos.length - remove.filter(e => e.kind === 'video').length > MAX_VIDEOS) remove.push(videos.shift()!);
  while (images.length - remove.filter(e => e.kind === 'image').length > MAX_IMAGES) remove.push(images.shift()!);

  for (const entry of [...entries].sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (total <= MAX_TOTAL_BYTES) break;
    if (remove.includes(entry)) continue;
    remove.push(entry);
    total -= Math.max(0, entry.bytes);
  }

  await Promise.all(remove.map(async entry => {
    await cache.delete(entry.url);
    await deleteMeta(entry.url);
  }));
}

export async function cacheMedia(url: string, forcedKind?: MediaKind): Promise<boolean> {
  if (!available() || !url || !/^https?:/i.test(url)) return false;
  const existing = await getMeta(url);
  if (existing) {
    await putMeta({ ...existing, lastUsed: Date.now() });
    return true;
  }

  try {
    const response = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!response.ok || !response.body) return false;
    const kind = forcedKind ?? kindFor(url, response);
    const bytes = Number(response.headers.get('content-length') || 0);
    if (kind === 'video' && bytes > MAX_VIDEO_BYTES) return false;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, response.clone());
    let measured = bytes;
    if (!measured) {
      try { measured = (await response.clone().arrayBuffer()).byteLength; } catch { measured = 0; }
    }
    await putMeta({ url, kind, bytes: measured, lastUsed: Date.now() });
    await trimCache();
    return true;
  } catch {
    return false;
  }
}

export async function warmOfflineVideos(urls: string[], minimum = MIN_VIDEOS) {
  const unique = Array.from(new Set(urls.filter(Boolean))).slice(0, MAX_VIDEOS);
  if (!unique.length) return 0;
  let cached = 0;
  // Sequential downloads avoid turning the feed into eight simultaneous large transfers.
  for (const url of unique) {
    if (await cacheMedia(url, 'video')) cached++;
    if (cached >= Math.min(minimum, unique.length)) break;
  }
  return cached;
}

export async function warmOfflineImages(urls: string[], limit = MAX_IMAGES) {
  const unique = Array.from(new Set(urls.filter(Boolean))).slice(0, limit);
  let cached = 0;
  for (const url of unique) if (await cacheMedia(url, 'image')) cached++;
  return cached;
}

export async function getOfflineMediaUrl(url: string): Promise<string | null> {
  if (!available() || !url) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(url);
    if (!response) return null;
    const meta = await getMeta(url);
    if (meta) await putMeta({ ...meta, lastUsed: Date.now() });
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export async function hasOfflineMedia(url: string) {
  if (!available() || !url) return false;
  try {
    return Boolean(await (await caches.open(CACHE_NAME)).match(url));
  } catch { return false; }
}

export async function warmOfflineFeedItems(items: any[]) {
  const videos: string[] = [];
  const images: string[] = [];
  for (const item of items ?? []) {
    const data = item?.data ?? item ?? {};
    const media = Array.isArray(data.media_urls) ? data.media_urls : [];
    const video = data.video_url ?? media.find((url: string) => /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url));
    const image = data.image_url ?? media.find((url: string) => url !== video);
    if (video) videos.push(String(video));
    if (image) images.push(String(image));
  }
  await Promise.all([
    warmOfflineVideos(videos, Math.min(MIN_VIDEOS, videos.length)),
    warmOfflineImages(images, Math.min(12, images.length)),
  ]);
}

export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
