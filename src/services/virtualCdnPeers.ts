/**
 * Zero-cost WebRTC segment exchange for the Testagram virtual CDN.
 *
 * Supabase Realtime is used only for small signaling messages. HLS bytes move
 * over direct WebRTC data channels, never through Supabase. If peers are absent,
 * blocked by NAT, slow, or disagree on a segment digest, the caller must use
 * the original IPTV source.
 *
 * Integrity model: two independent origin-sourced peer caches must return the
 * same SHA-256 digest before a segment is accepted. This detects corruption and
 * single-peer poisoning, but is not equivalent to a source-signed hash. Therefore
 * only segments previously fetched directly from the origin may be served onward;
 * peer-derived bytes are never promoted into the peer-serving cache.
 */
import { supabase } from '@/lib/supabase';
import { recordVirtualCdnMetric } from '@/services/virtualCdnMetrics';

export type PeerSegment = {
  url: string;
  bytes: ArrayBuffer;
  contentType: string;
  originVerified: boolean;
};

type PeerCache = (url: string, requireOrigin?: boolean) => Promise<PeerSegment | null>;
type SignalPayload = { from: string; to: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
type Transfer = { requestId: string; resolve: (value: PeerSegment | null) => void; timer: ReturnType<typeof setTimeout>; meta: any; chunks: Uint8Array[]; received: number };

const MAX_PEERS = 3;
const MAX_SEGMENT_BYTES = 1_500_000;
const CHUNK_BYTES = 16 * 1024;
const PEER_REQUEST_TIMEOUT_MS = 1_000;
const SIGNALING_WAIT_MS = 200;
const MAX_ROOMS = 4;
// Random cohorts cap per-room fan-out. At one million viewers, 65,536 cohorts
// average about 15 members each; this does not reduce total signaling connections.
const SIGNALING_COHORTS = 65_536;
const STUN_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

function peerSharingEnabled() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('testagram-tv-peer-sharing') === 'on'; }
  catch { return false; }
}

function peerTransportAllowed() {
  if (!peerSharingEnabled()) return false;
  try {
    if (localStorage.getItem('testagram-tv-data-saver') === 'on') return false;
    const connection = (navigator as any).connection;
    if (connection?.saveData || ['slow-2g', '2g'].includes(String(connection?.effectiveType || '').toLowerCase())) return false;
    if (String(connection?.type || '').toLowerCase() === 'cellular') return false;
  } catch { return false; }
  return true;
}

function uploadAllowed() { return peerTransportAllowed(); }

function randomId() {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
}

function sensitiveUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (/(^|_)(token|signature|sig|auth|authorization|apikey|api_key|expires|credential|key)(_|$)/i.test(key)) return true;
    }
    return false;
  } catch { return true; }
}

function publicStreamUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.username || url.password || sensitiveUrl(value)) return false;
    if (/^(localhost|.*\.(local|internal|lan|home|test))$/i.test(host)) return false;
    if (host.startsWith('[') && /^(\[::1\]|\[fe[89ab][0-9a-f]:|\[f[cd][0-9a-f]{2}:|\[ff[0-9a-f]{2}:)/i.test(host)) return false;
    const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ip) {
      const [a, b, c, d] = ip.slice(1).map(Number);
      if ([a, b, c, d].some((part) => part > 255) || a === 0 || a === 10 || a === 127 || a >= 224 ||
          (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
    }
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch { return false; }
}

async function digest(bytes: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

const streamRoomIds = new Map<string, string>();

async function roomId(streamUrl: string) {
  const url = new URL(streamUrl);
  // Remove fragment only; sensitive query strings are rejected before this point.
  url.hash = '';
  const canonical = url.href;
  const existing = streamRoomIds.get(canonical);
  if (existing) return existing;
  const encoded = new TextEncoder().encode(canonical);
  const encodedBuffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
  const hash = await digest(encodedBuffer);
  const cohortBytes = new Uint16Array(1);
  try { crypto.getRandomValues(cohortBytes); } catch { cohortBytes[0] = Math.floor(Math.random() * 65_536); }
  const cohort = cohortBytes[0] % SIGNALING_COHORTS;
  const name = `vcdn-${hash.slice(0, 16)}-${cohort.toString(16).padStart(4, '0')}`;
  if (streamRoomIds.size >= MAX_ROOMS * 2) streamRoomIds.delete(streamRoomIds.keys().next().value as string);
  streamRoomIds.set(canonical, name);
  return name;
}

class StreamPeerRoom {
  readonly id = randomId();
  readonly peers = new Map<string, RTCPeerConnection>();
  readonly channels = new Map<string, RTCDataChannel>();
  readonly pending = new Map<string, Transfer>();
  readonly requestingPeers = new Set<string>();
  readonly uploading = new Set<string>();
  readonly lastServedAt = new Map<string, number>();
  readonly candidateQueues = new Map<string, RTCIceCandidateInit[]>();
  channel: ReturnType<typeof supabase.channel> | null = null;
  ready = false;
  closed = false;
  lastUsed = Date.now();
  subscribePromise: Promise<void>;
  syncTimer: ReturnType<typeof setTimeout> | null = null;
  cache: PeerCache;

  constructor(readonly roomName: string, cache: PeerCache) {
    this.cache = cache;
    this.subscribePromise = this.subscribe();
  }

  private async subscribe() {
    const channel = supabase.channel(this.roomName, {
      config: { broadcast: { self: false }, presence: { key: this.id } },
    });
    this.channel = channel;
    channel
      .on('broadcast', { event: 'signal' }, ({ payload }: { payload: SignalPayload }) => {
        if (!payload || payload.to !== this.id || payload.from === this.id) return;
        void this.onSignal(payload);
      })
      .on('presence', { event: 'sync' }, () => { this.schedulePeerSync(); });
    await new Promise<void>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve();
      }, 3_000);
      channel.subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          this.ready = true;
          try { await channel.track({ peerId: this.id, protocol: 1, joinedAt: Date.now() }); } catch {}
          if (!settled) { settled = true; clearTimeout(timer); resolve(); }
          this.schedulePeerSync();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (!settled) { settled = true; clearTimeout(timer); resolve(); }
        }
      });
    });
  }

  private async signal(payload: Omit<SignalPayload, 'from'>) {
    if (!this.channel || !this.ready) return;
    try {
      await this.channel.send({ type: 'broadcast', event: 'signal', payload: { ...payload, from: this.id } });
    } catch {
      recordVirtualCdnMetric('signalingFailure');
      // Signaling is best-effort; the caller falls back to the origin.
    }
  }

  private schedulePeerSync() {
    if (this.closed || this.syncTimer) return;
    // Spread offer creation across a cohort to avoid synchronized connection bursts.
    const jitterMs = 100 + Math.floor(Math.random() * 700);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncPeers();
    }, jitterMs);
  }

  private async syncPeers() {
    if (this.closed || !this.channel || !this.ready) return;
    const state = this.channel.presenceState() as Record<string, Array<{ peerId?: string; protocol?: number }>>;
    const ids = [...new Set(Object.values(state).flat().map((p) => p.peerId).filter((id): id is string => !!id && id !== this.id))];
    // Randomized peer selection prevents every viewer from connecting to the
    // same first three presence entries and creating upload hotspots.
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    for (const peerId of ids) {
      if (this.peers.size >= MAX_PEERS) break;
      if (this.peers.has(peerId)) continue;
      // Deterministic initiator prevents simultaneous offer glare.
      if (this.id.localeCompare(peerId) < 0) void this.makeOffer(peerId);
    }
    for (const peerId of this.peers.keys()) {
      if (!ids.includes(peerId)) this.dropPeer(peerId);
    }
  }

  private connection(peerId: string) {
    let pc = this.peers.get(peerId);
    if (pc) return pc;
    if (this.peers.size >= MAX_PEERS) throw new Error('Peer connection limit reached');
    pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.peers.set(peerId, pc);
    pc.onicecandidate = (event) => {
      if (event.candidate) void this.signal({ to: peerId, candidate: event.candidate.toJSON() });
    };
    pc.ondatachannel = (event) => this.attachDataChannel(peerId, event.channel);
    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === 'connected') recordVirtualCdnMetric('connectionSuccess');
      if (pc && ['failed', 'closed'].includes(pc.connectionState)) {
        if (pc.connectionState === 'failed') recordVirtualCdnMetric('connectionFailure');
        this.dropPeer(peerId);
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (pc && ['failed', 'closed'].includes(pc.iceConnectionState)) this.dropPeer(peerId);
    };
    return pc;
  }

  private attachDataChannel(peerId: string, dataChannel: RTCDataChannel) {
    dataChannel.binaryType = 'arraybuffer';
    dataChannel.bufferedAmountLowThreshold = 256 * 1024;
    this.channels.set(peerId, dataChannel);
    dataChannel.onmessage = (event) => { void this.onData(peerId, event.data); };
    dataChannel.onclose = () => { if (this.channels.get(peerId) === dataChannel) this.channels.delete(peerId); };
    dataChannel.onerror = () => this.dropPeer(peerId);
  }

  private async makeOffer(peerId: string) {
    try {
      const pc = this.connection(peerId);
      if (pc.signalingState !== 'stable') return;
      const dataChannel = pc.createDataChannel('testagram-vcdn-v1', { ordered: true });
      this.attachDataChannel(peerId, dataChannel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.signal({ to: peerId, description: pc.localDescription?.toJSON() });
    } catch { this.dropPeer(peerId); }
  }

  private async onSignal(payload: SignalPayload) {
    try {
      const pc = this.connection(payload.from);
      if (payload.candidate) {
        try { await pc.addIceCandidate(payload.candidate); }
        catch {
          const queue = this.candidateQueues.get(payload.from) || [];
          queue.push(payload.candidate);
          this.candidateQueues.set(payload.from, queue);
        }
        return;
      }
      if (!payload.description) return;
      await pc.setRemoteDescription(payload.description);
      const queued = this.candidateQueues.get(payload.from) || [];
      this.candidateQueues.delete(payload.from);
      for (const candidate of queued) { try { await pc.addIceCandidate(candidate); } catch {} }
      if (payload.description.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.signal({ to: payload.from, description: pc.localDescription?.toJSON() });
      }
    } catch { this.dropPeer(payload.from); }
  }

  private async onData(peerId: string, data: unknown) {
    if (typeof data === 'string') {
      let message: any;
      try { message = JSON.parse(data); } catch { return; }
      if (message?.type === 'get' && typeof message.requestId === 'string' && typeof message.url === 'string') {
        void this.serve(peerId, message);
      } else if (message?.type === 'start') {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        if (message.url !== pending.meta?.url || !Number.isSafeInteger(message.size) || message.size < 1 || message.size > MAX_SEGMENT_BYTES || !/^[a-f0-9]{64}$/.test(message.sha256)) {
          this.finish(message.requestId, null);
          return;
        }
        pending.meta = { ...message, peerId: pending.meta.peerId, expectedUrl: pending.meta.url };
        pending.chunks = [];
        pending.received = 0;
      } else if (message?.type === 'end') {
        const pending = this.pending.get(message.requestId);
        if (!pending?.meta) return;
        const bytes = new Uint8Array(pending.received);
        let offset = 0;
        for (const chunk of pending.chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const buffer = bytes.buffer;
        const hash = await digest(buffer);
        if (pending.received !== pending.meta.size || hash !== pending.meta.sha256 || pending.meta.url !== pending.meta.expectedUrl) {
          recordVirtualCdnMetric('integrityFailure');
          this.finish(message.requestId, null);
          return;
        }
        this.finish(message.requestId, { url: pending.meta.url, bytes: buffer, contentType: pending.meta.contentType || 'application/octet-stream', originVerified: true });
      } else if (message?.type === 'miss') {
        this.finish(message.requestId, null);
      }
      return;
    }
    if (!(data instanceof ArrayBuffer)) return;
    // Match our sender's frame bound before retaining any received payload.
    if (data.byteLength < 1 || data.byteLength > CHUNK_BYTES) {
      recordVirtualCdnMetric('integrityFailure');
      const pending = [...this.pending.values()].find((entry) => entry.meta?.peerId === peerId);
      if (pending) this.finish(pending.requestId, null);
      return;
    }
    // The only outstanding transfer on a peer channel owns incoming binary frames.
    const pending = [...this.pending.values()].find((entry) => entry.meta?.peerId === peerId && entry.meta?.size && entry.received < entry.meta.size);
    if (!pending) return;
    if (pending.received + data.byteLength > pending.meta.size) {
      this.finish(pending.requestId, null);
      return;
    }
    pending.chunks.push(new Uint8Array(data));
    pending.received += data.byteLength;
  }

  private async serve(peerId: string, message: any) {
    const dc = this.channels.get(peerId);
    if (!dc || dc.readyState !== 'open') return;
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const url = String(message.url || '');
    const reject = () => { try { dc.send(JSON.stringify({ type: 'miss', requestId })); } catch {} };
    if (!requestId || requestId.length > 80 || !publicStreamUrl(url) || message.room !== this.roomName ||
        !uploadAllowed() || this.uploading.size >= 1 || Date.now() - (this.lastServedAt.get(peerId) || 0) < 800) {
      reject();
      return;
    }
    this.uploading.add(peerId);
    this.lastServedAt.set(peerId, Date.now());
    try {
      const cached = await this.cache(url, true);
      if (!cached || !cached.originVerified || cached.bytes.byteLength < 1 || cached.bytes.byteLength > MAX_SEGMENT_BYTES) {
        reject();
        return;
      }
      const sha256 = await digest(cached.bytes);
      dc.send(JSON.stringify({ type: 'start', requestId, url, size: cached.bytes.byteLength, contentType: cached.contentType, sha256 }));
      const bytes = new Uint8Array(cached.bytes);
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        if (dc.readyState !== 'open') return;
        dc.send(bytes.slice(offset, Math.min(offset + CHUNK_BYTES, bytes.length)));
        if (dc.bufferedAmount > 512 * 1024) {
          const drained = await new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (ok: boolean) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              dc.onbufferedamountlow = null;
              resolve(ok);
            };
            const timeout = setTimeout(() => finish(false), 200);
            dc.onbufferedamountlow = () => finish(true);
          });
          if (!drained || dc.bufferedAmount > 512 * 1024) { reject(); return; }
        }
      }
      dc.send(JSON.stringify({ type: 'end', requestId }));
      recordVirtualCdnMetric('peerBytesServed', bytes.byteLength);
    } catch {
      reject();
    } finally {
      this.uploading.delete(peerId);
    }
  }

  private finish(requestId: string, result: PeerSegment | null) {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.resolve(result);
  }

  private dropPeer(peerId: string) {
    const pc = this.peers.get(peerId);
    try { pc?.close(); } catch {}
    this.peers.delete(peerId);
    this.channels.delete(peerId);
    this.candidateQueues.delete(peerId);
    this.uploading.delete(peerId);
    this.requestingPeers.delete(peerId);
    this.lastServedAt.delete(peerId);
    for (const [requestId, pending] of this.pending) {
      if (pending.meta?.peerId === peerId) this.finish(requestId, null);
    }
  }

  async fetchQuorum(url: string): Promise<PeerSegment | null> {
    this.lastUsed = Date.now();
    if (this.closed || !this.ready || !publicStreamUrl(url)) return null;
    recordVirtualCdnMetric('peerRequest');
    const candidates = [...this.channels.entries()].filter(([peerId, dc]) => dc.readyState === 'open' && !this.requestingPeers.has(peerId)).slice(0, MAX_PEERS);
    if (candidates.length < 2) { recordVirtualCdnMetric('peerMiss'); return null; }
    const requestFrom = (peerId: string, dc: RTCDataChannel) => new Promise<PeerSegment | null>((resolve) => {
      this.requestingPeers.add(peerId);
      const requestId = randomId();
      const timer = setTimeout(() => {
        recordVirtualCdnMetric('transferTimeout');
        this.finish(requestId, null);
      }, PEER_REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { requestId, resolve: (result) => { this.requestingPeers.delete(peerId); resolve(result); }, timer, meta: { peerId, url }, chunks: [], received: 0 });
      try { dc.send(JSON.stringify({ type: 'get', requestId, url, room: this.roomName })); }
      catch { this.finish(requestId, null); }
    });
    const responses = await Promise.all(candidates.slice(0, 2).map(([peerId, dc]) => requestFrom(peerId, dc)));
    if (!responses[0] || !responses[1]) { recordVirtualCdnMetric('peerMiss'); return null; }
    if (responses[0].bytes.byteLength !== responses[1].bytes.byteLength) {
      recordVirtualCdnMetric('integrityFailure'); recordVirtualCdnMetric('peerMiss'); return null;
    }
    const [firstHash, secondHash] = await Promise.all([digest(responses[0].bytes), digest(responses[1].bytes)]);
    if (firstHash !== secondHash) { recordVirtualCdnMetric('integrityFailure'); recordVirtualCdnMetric('peerMiss'); return null; }
    recordVirtualCdnMetric('peerHit');
    recordVirtualCdnMetric('peerBytesReceived', responses[0].bytes.byteLength);
    return { ...responses[0], originVerified: false };
  }

  close() {
    this.closed = true;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    for (const peerId of [...this.peers.keys()]) this.dropPeer(peerId);
    for (const requestId of [...this.pending.keys()]) this.finish(requestId, null);
    try { if (this.channel) void supabase.removeChannel(this.channel); } catch {}
    this.channel = null;
    this.ready = false;
  }
}

const rooms = new Map<string, StreamPeerRoom>();

export async function fetchVirtualPeerSegment(streamUrl: string, segmentUrl: string, cache: PeerCache) {
  if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined' || !peerTransportAllowed()) return null;
  if (!publicStreamUrl(streamUrl) || !publicStreamUrl(segmentUrl)) return null;
  try {
    const name = await roomId(streamUrl);
    let room = rooms.get(name);
    if (!room || room.closed) {
      if (rooms.size >= MAX_ROOMS) {
        const oldest = [...rooms.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
        if (oldest) { oldest[1].close(); rooms.delete(oldest[0]); }
      }
      room = new StreamPeerRoom(name, cache);
      rooms.set(name, room);
    }
    room.lastUsed = Date.now();
    await Promise.race([room.subscribePromise, new Promise<void>((resolve) => setTimeout(resolve, SIGNALING_WAIT_MS))]);
    if (!room.ready) return null;
    return await room.fetchQuorum(segmentUrl);
  } catch {
    return null;
  }
}

export function closeVirtualPeerRooms() {
  for (const room of rooms.values()) room.close();
  rooms.clear();
  streamRoomIds.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', closeVirtualPeerRooms);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Do not tear down immediately; background tabs may be used as useful peers.
      for (const room of rooms.values()) room.lastUsed = Date.now();
    }
  });
}
