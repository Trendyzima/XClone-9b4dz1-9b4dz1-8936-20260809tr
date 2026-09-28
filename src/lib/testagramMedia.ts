import { supabase, supabasePublishableKey, supabaseUrl } from '@/lib/supabase';

export type MediaRoomType = 'tv' | 'space' | 'call';
export type MediaRole = 'host' | 'viewer' | 'guest' | 'listener' | 'speaker' | 'participant';

type MediaToken = {
  token: string;
  ws_url: string;
  room_id: string;
  room_type: MediaRoomType;
  role: MediaRole;
  ice_servers?: RTCIceServer[];
};

type Signal = {
  type: 'offer' | 'answer' | 'candidate' | 'presence';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  viewer_count?: number;
  guest_count?: number;
  participant_count?: number;
};

const waitForIce = async (pc: RTCPeerConnection) => {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>(resolve => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', done); resolve(); };
    pc.addEventListener('icegatheringstatechange', done);
    window.setTimeout(() => { pc.removeEventListener('icegatheringstatechange', done); resolve(); }, 5000);
  });
};

const getToken = async (roomId: string, roomType: MediaRoomType, role: MediaRole, inviteToken?: string): Promise<MediaToken> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Sign in to use Testagram media.');
  const response = await fetch(`${supabaseUrl}/functions/v1/testagram-media-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ room_id: roomId, room_type: roomType, role, invite_token: inviteToken || undefined }),
  });
  let payload: any = null;
  try { payload = await response.json(); } catch { /* preserve HTTP status below */ }
  if (!response.ok) {
    const code = payload?.error?.code ? ` [${payload.error.code}]` : '';
    const message = payload?.error?.message || `Media authorization failed (HTTP ${response.status}).`;
    throw new Error(`${message}${code}`);
  }
  if (!payload?.data?.token || !payload?.data?.ws_url) {
    throw new Error('Testagram Media Engine returned an incomplete authorization response.');
  }
  return payload.data as MediaToken;
};

export class TestagramMediaSession {
  readonly role: MediaRole;
  readonly roomId: string;
  readonly roomType: MediaRoomType;
  pc!: RTCPeerConnection;

  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private info: MediaToken | null = null;
  private localStream: MediaStream | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private onRemoteStream?: (stream: MediaStream) => void;
  private onRemoteTrack?: (track: MediaStreamTrack) => void;
  private onViewerCount?: (count: number, guests: number) => void;
  private onParticipantCount?: (count: number) => void;
  private answerReceived = false;
  private remoteStream = new MediaStream();
  private lastDiagnostics: Record<string, unknown> = {};

  getDiagnostics() { return { ...this.lastDiagnostics }; }

  async waitForMediaReady(direction: 'send' | 'receive', timeoutMs = 20000) {
    const started = Date.now();
    let last = '';
    while (Date.now() - started < timeoutMs) {
      if (this.closed || !this.pc) throw new Error('Media session closed while waiting for transport readiness.');
      const state = this.pc.connectionState;
      const ice = this.pc.iceConnectionState;
      let videoPackets = 0, videoBytes = 0, videoFrames = 0, width = 0, height = 0;
      let audioPackets = 0, audioBytes = 0;
      const stats = await this.pc.getStats();
      stats.forEach(report => {
        if (direction === 'send' && report.type === 'outbound-rtp' && report.kind === 'video') {
          videoPackets += Number(report.packetsSent || 0); videoBytes += Number(report.bytesSent || 0); videoFrames += Number(report.framesEncoded || 0);
          width = Number(report.frameWidth || 0); height = Number(report.frameHeight || 0);
        }
        if (direction === 'send' && report.type === 'outbound-rtp' && report.kind === 'audio') {
          audioPackets += Number(report.packetsSent || 0); audioBytes += Number(report.bytesSent || 0);
        }
        if (direction === 'receive' && report.type === 'inbound-rtp' && report.kind === 'video') {
          videoPackets += Number(report.packetsReceived || 0); videoBytes += Number(report.bytesReceived || 0); videoFrames += Number(report.framesDecoded || 0);
          width = Number(report.frameWidth || 0); height = Number(report.frameHeight || 0);
        }
      });
      this.lastDiagnostics = { connectionState: state, iceConnectionState: ice, videoPackets, videoBytes, audioPackets, audioBytes, packets: videoPackets, bytes: videoBytes, frames: videoFrames, width, height, elapsedMs: Date.now() - started };
      if (state === 'failed' || state === 'closed' || ice === 'failed' || ice === 'closed') throw new Error(`WebRTC transport failed (connection=${state}, ICE=${ice}).`);
      const mediaReady = direction === 'send'
        ? videoPackets > 0 && videoBytes > 0 && audioPackets > 0 && audioBytes > 0
        : videoPackets > 0 && videoBytes > 0;
      if (state === 'connected' && ice === 'connected' && mediaReady) return this.getDiagnostics();
      last = `connection=${state}, ICE=${ice}, videoPackets=${videoPackets}, audioPackets=${audioPackets}`;
      await new Promise(resolve => window.setTimeout(resolve, 250));
    }
    throw new Error(`Media transport did not become ready within ${Math.round(timeoutMs / 1000)}s (${last || 'no WebRTC state observed'}).`);
  }

  private constructor(roomType: MediaRoomType, role: MediaRole, roomId: string) {
    this.roomType = roomType; this.role = role; this.roomId = roomId;
  }

  static async connectHost(streamId: string, program: MediaStream) {
    const session = new TestagramMediaSession('tv', 'host', streamId);
    session.localStream = program; await session.connect(true); return session;
  }

  static async connectViewer(streamId: string, onRemoteStream: (stream: MediaStream) => void) {
    const session = new TestagramMediaSession('tv', 'viewer', streamId);
    session.onRemoteStream = onRemoteStream; await session.connect(true); return session;
  }

  static async connectGuest(streamId: string, inviteToken: string, onRemoteStream?: (stream: MediaStream) => void) {
    const session = new TestagramMediaSession('tv', 'guest', streamId);
    session.onRemoteStream = onRemoteStream;
    session.info = await getToken(streamId, 'tv', 'guest', inviteToken);
    await session.connect(false); return session;
  }

  static async connectSpace(spaceId: string, role: 'host' | 'listener' | 'speaker', localStream?: MediaStream, onRemoteStream?: (stream: MediaStream) => void) {
    const session = new TestagramMediaSession('space', role, spaceId);
    session.localStream = localStream || null; session.onRemoteStream = onRemoteStream;
    await session.connect(true); return session;
  }

  static async connectCall(callId: string, localStream: MediaStream, onRemoteStream: (stream: MediaStream) => void) {
    const session = new TestagramMediaSession('call', 'participant', callId);
    session.localStream = localStream; session.onRemoteStream = onRemoteStream;
    await session.connect(true); return session;
  }

  setRemoteTrackHandler(handler: (track: MediaStreamTrack) => void) { this.onRemoteTrack = handler; }
  setViewerCountHandler(handler: (count: number, guests: number) => void) { this.onViewerCount = handler; }
  setParticipantCountHandler(handler: (count: number) => void) { this.onParticipantCount = handler; }
  async configureVideoSender(options: { maxBitrate: number; maxFramerate?: number; maintainResolution?: boolean } ) {
    if (!this.pc) return;
    for (const sender of this.pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      try {
        const params = sender.getParameters();
        params.encodings ??= [{}];
        for (const encoding of params.encodings) {
          encoding.maxBitrate = options.maxBitrate;
          if (options.maxFramerate) encoding.maxFramerate = options.maxFramerate;
        }
        if (options.maintainResolution && 'degradationPreference' in params) {
          (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = 'maintain-resolution';
        }
        await sender.setParameters(params);
      } catch (error) {
        console.warn('[Testagram Media Engine] video sender tuning unavailable; continuing with browser defaults', error);
      }
    }
  }


  async publishTracks(stream: MediaStream) {
    this.localStream = stream;
    if (!this.pc || this.pc.connectionState === 'closed') { await this.connect(false); return; }
    for (const track of stream.getTracks()) if (!this.pc.getSenders().some(sender => sender.track?.id === track.id)) this.pc.addTrack(track, stream);
    await this.sendOffer();
  }

  private createPeerConnection(iceServers: RTCIceServer[] = []) {
    const pc = new RTCPeerConnection({
      iceServers: iceServers.length ? iceServers : [{ urls: 'stun:stun.l.google.com:19302' }],
      bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require',
    });
    this.pc = pc;
    pc.ontrack = event => {
      const track = event.track;
      if (!this.remoteStream.getTracks().some(existing => existing.id === track.id)) this.remoteStream.addTrack(track);
      this.onRemoteTrack?.(track); this.onRemoteStream?.(this.remoteStream);
    };
    pc.onicecandidate = event => {
      if (event.candidate && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate.toJSON() }));
    };
    pc.onconnectionstatechange = () => {
      if (!this.closed && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) this.scheduleReconnect();
    };
  }

  private async connect(createInitialOffer: boolean) {
    if (this.closed) return;
    this.info ??= await getToken(this.roomId, this.roomType, this.role);
    this.answerReceived = false;
    this.createPeerConnection(this.info.ice_servers || []);

    if (this.roomType === 'tv') {
      if (this.role === 'host') {
        this.localStream?.getTracks().forEach(track => this.pc.addTrack(track, this.localStream!));
      } else if (this.role === 'viewer') {
        this.pc.addTransceiver('video', { direction: 'recvonly' });
        this.pc.addTransceiver('audio', { direction: 'recvonly' });
      } else if (this.localStream) {
        this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream!));
      }
    } else if (this.roomType === 'space') {
      if (this.role === 'listener') this.pc.addTransceiver('audio', { direction: 'recvonly' });
      else this.localStream?.getTracks().forEach(track => this.pc.addTrack(track, this.localStream!));
    } else {
      this.localStream?.getTracks().forEach(track => this.pc.addTrack(track, this.localStream!));
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.info!.ws_url + (this.info!.ws_url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(this.info!.token));
      this.ws = ws;
      const timeout = window.setTimeout(() => reject(new Error('Testagram Media Engine connection timed out.')), 15000);
      ws.onopen = async () => {
        window.clearTimeout(timeout); this.reconnectAttempt = 0;
        try { if (createInitialOffer || this.role !== 'guest' || this.localStream) await this.sendOffer(); if (createInitialOffer || this.role !== 'guest' || this.localStream) { const started = Date.now(); while (!this.answerReceived && Date.now() - started < 15000) await new Promise(r => window.setTimeout(r, 50)); if (!this.answerReceived) throw new Error('Testagram Media Engine did not return a WebRTC answer.'); } resolve(); } catch (error) { reject(error); }
      };
      ws.onerror = () => { window.clearTimeout(timeout); reject(new Error('Could not connect to Testagram Media Engine.')); };
      ws.onclose = () => { if (!this.closed) this.scheduleReconnect(); };
      ws.onmessage = async event => {
        try {
          const message = JSON.parse(event.data) as Signal;
          if (message.type === 'presence') {
            this.onViewerCount?.(Number(message.viewer_count || 0), Number(message.guest_count || 0));
            this.onParticipantCount?.(Number(message.participant_count || 0)); return;
          }
          if (message.type === 'candidate' && message.candidate) {
            if (this.pc.remoteDescription) await this.pc.addIceCandidate(message.candidate); else this.pendingCandidates.push(message.candidate); return;
          }
          if (message.type === 'answer' && message.sdp) {
            await this.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp }); await this.flushCandidates(); this.answerReceived = true; return;
          }
          if (message.type === 'offer' && message.sdp) {
            await this.pc.setRemoteDescription({ type: 'offer', sdp: message.sdp }); await this.flushCandidates();
            const answer = await this.pc.createAnswer(); await this.pc.setLocalDescription(answer); await waitForIce(this.pc);
            if (this.ws?.readyState === WebSocket.OPEN && this.pc.localDescription) this.ws.send(JSON.stringify({ type: 'answer', sdp: this.pc.localDescription.sdp }));
          }
        } catch (error) { console.warn('[Testagram Media Engine] signaling error', error); }
      };
    });
  }

  private async flushCandidates() {
    const candidates = this.pendingCandidates.splice(0);
    for (const candidate of candidates) { try { await this.pc.addIceCandidate(candidate); } catch {} }
  }

  private async sendOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer); await waitForIce(this.pc);
    if (this.ws?.readyState !== WebSocket.OPEN || !this.pc.localDescription) throw new Error('Testagram Media Engine signaling channel is not ready.');
    this.ws.send(JSON.stringify({ type: 'offer', sdp: this.pc.localDescription.sdp }));
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer !== null) return;
    const delay = Math.min(1000 * (2 ** Math.min(this.reconnectAttempt, 5)), 30000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer = null; void this.reconnect(); }, delay);
  }

  private async reconnect() {
    if (this.closed) return;
    try {
      this.info = await getToken(this.roomId, this.roomType, this.role);
      this.ws?.close(); this.ws = null; await this.pc?.close();
      this.pendingCandidates = []; this.remoteStream = new MediaStream(); await this.connect(true);
    } catch { this.scheduleReconnect(); }
  }

  async close() {
    this.closed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null; this.ws?.close(); this.ws = null;
    this.pc?.getSenders().forEach(sender => sender.track?.stop()); await this.pc?.close();
    this.pc = undefined as unknown as RTCPeerConnection;
  }
}
