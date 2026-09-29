import { supabase, supabasePublishableKey, supabaseUrl } from '@/lib/supabase';

export type MediaRoomType = 'tv' | 'space' | 'call';
export type MediaRole = 'host' | 'viewer' | 'guest' | 'listener' | 'speaker' | 'participant';

type MediaToken = {
  token: string;
  ws_url?: string;
  whip_url?: string;
  whep_url?: string;
  playback_url?: string;
  provider?: 'native' | 'cloudflare-stream' | 'cloudflare-stream-hybrid' | 'cloudflare-mux-hybrid' | 'youtube-cloudflare-hybrid' | 'srs-youtube-hybrid' | 'srs-mux-hybrid' | 'mux' | 'youtube';
  room_id: string;
  room_type: MediaRoomType;
  role: MediaRole;
  title?: string | null;
  viewer_count?: number;
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

const tvControlApiUrl = () => {
  const origin = window.location.origin;
  // The apex domain redirects to www. A relative POST to /api/live would
  // cross origins during the 308 redirect and browsers surface that as
  // the opaque TypeError: Failed to fetch.
  return (origin === 'https://testagram.site' ? 'https://www.testagram.site' : origin) + '/api/live';
};

const tvControlFetch = (init: RequestInit) => fetch(tvControlApiUrl(), init);

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
  if (roomType === 'tv' && (role === 'host' || role === 'viewer')) {
    const response = await tvControlFetch({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ action: role === 'host' ? 'start' : 'viewer', stream_id: roomId }),
    });
    let payload: any = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const code = payload?.error?.code ? ` [${payload.error.code}]` : '';
      const message = payload?.error?.message || `TV media authorization failed (HTTP ${response.status}).`;
      throw new Error(`${message}${code}`);
    }
    const provider = payload?.data?.provider;
    const isMuxHybrid = provider === 'cloudflare-mux-hybrid' || provider === 'srs-mux-hybrid';
    const isYouTubeHybrid = provider === 'youtube-cloudflare-hybrid' || provider === 'srs-youtube-hybrid';
    const isSrs = provider === 'srs-youtube-hybrid' || provider === 'srs-mux-hybrid';
    const hasHostTransport = Boolean(payload?.data?.whip_url);
    const hasViewerPlayback = Boolean(payload?.data?.playback_url);
    const hasLegacyTransport = Boolean(payload?.data?.whep_url || payload?.data?.whip_url);
    if (role === 'viewer' && (isMuxHybrid || isYouTubeHybrid)) {
      if (!hasViewerPlayback) throw new Error(`TV playback authorization returned no ${isYouTubeHybrid ? 'YouTube' : 'Mux'} playback URL [STREAM_PLAYBACK_NOT_READY].`);
    } else if (role === 'host' && (isMuxHybrid || isYouTubeHybrid)) {
      if (!hasHostTransport) throw new Error(`TV broadcast authorization returned no ${isSrs ? 'SRS' : 'Cloudflare'} WHIP ingest endpoint [INGEST_ENDPOINT_MISSING].`);
    } else if (!['cloudflare-stream', 'cloudflare-stream-hybrid'].includes(provider) || !hasLegacyTransport) {
      throw new Error('Vercel TV media authorization returned an incomplete transport response.');
    }
    return payload.data as MediaToken;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: supabasePublishableKey,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${supabaseUrl}/functions/v1/testagram-media-token`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ room_id: roomId, room_type: roomType, role, invite_token: inviteToken || undefined }),
  });
  let payload: any = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const code = payload?.error?.code ? ` [${payload.error.code}]` : '';
    const message = payload?.error?.message || `Media authorization failed (HTTP ${response.status}).`;
    throw new Error(`${message}${code}`);
  }
  if (!payload?.data?.token || !payload?.data?.ws_url) {
    throw new Error('Testagram media authorization returned an incomplete transport response.');
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
  private mediaSessionUrl: string | null = null;
  private remoteStream = new MediaStream();
  private lastDiagnostics: Record<string, unknown> = {};

  getDiagnostics() { return { ...this.lastDiagnostics }; }
  getPlaybackUrl() { return this.info?.playback_url || (this.role === 'viewer' ? null : this.info?.whep_url) || null; }
  isMuxPlayback() { return this.roomType === 'tv' && this.role === 'viewer' && (this.info?.provider === 'cloudflare-mux-hybrid' || this.info?.provider === 'srs-mux-hybrid' || this.info?.provider === 'mux'); }
  isYouTubePlayback() { return this.roomType === 'tv' && this.role === 'viewer' && (this.info?.provider === 'youtube-cloudflare-hybrid' || this.info?.provider === 'srs-youtube-hybrid'); }
  getTitle() { return this.info?.title || null; }
  getViewerCount() { return Number(this.info?.viewer_count || 0); }
  async verifyOnAir() {
    if (this.roomType !== 'tv' || this.role !== 'host') throw new Error('ON AIR verification is only available for the TV broadcaster.');
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error('Sign in to verify the broadcast.');
    const response = await tvControlFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ action: 'verify', stream_id: this.roomId, diagnostics: this.getDiagnostics() }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload?.error?.code ? ` [${payload.error.code}]` : '';
      throw new Error(`${payload?.error?.message || 'SRS ON AIR verification failed.'}${code}`);
    }
    return payload?.data;
  }

  async stopBroadcastControlPlane() {
    if (this.roomType !== 'tv' || this.role !== 'host') return;
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) return;
    const response = await tvControlFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ action: 'stop', stream_id: this.roomId }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`${payload?.error?.message || 'SRS broadcast shutdown failed.'}${payload?.error?.code ? ` [${payload.error.code}]` : ''}`);
    }
  }


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
      this.lastDiagnostics = { ...this.lastDiagnostics, connectionState: state, iceConnectionState: ice, videoPackets, videoBytes, audioPackets, audioBytes, packets: videoPackets, bytes: videoBytes, frames: videoFrames, width, height, elapsedMs: Date.now() - started };
      if (state === 'failed' || state === 'closed' || ice === 'failed' || ice === 'closed') throw new Error(`WebRTC transport failed (connection=${state}, ICE=${ice}).`);
      const mediaReady = direction === 'send'
        ? videoPackets > 0 && videoBytes > 0 && audioPackets > 0 && audioBytes > 0
        : videoPackets > 0 && videoBytes > 0;
      const iceReady = ice === 'connected' || ice === 'completed';
      if (state === 'connected' && iceReady && mediaReady) return this.getDiagnostics();
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
    session.localStream = program;
    try {
      await session.connect(true);
      return session;
    } catch (error) {
      // /api/live persists the YouTube/Mux control-plane allocation before WHIP.
      // If browser signaling fails after that point, this session must reconcile
      // the allocation itself; the caller cannot receive a session object from a
      // failed async connect().
      await session.stopBroadcastControlPlane().catch(() => undefined);
      await session.close().catch(() => undefined);
      throw error;
    }
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

  private async connectWhipStream() {
    const endpoint = this.role === 'host' ? this.info?.whip_url : this.info?.whep_url;
    if (!endpoint) throw new Error(`${this.info?.provider?.startsWith('srs-') ? 'Testagram SRS' : 'Cloudflare Stream'} ${this.role === 'host' ? 'WHIP' : 'WHEP'} endpoint was not returned.`);
    const srsProvider = this.info?.provider?.startsWith('srs-') === true;
    this.createPeerConnection(this.info?.ice_servers || (srsProvider ? [] : [{ urls: 'stun:stun.cloudflare.com:3478' }]));
    if (this.role === 'host') {
      if (!this.localStream) throw new Error(`${srsProvider ? 'SRS' : 'Cloudflare'} publisher has no production media stream.`);
      const video = this.localStream.getVideoTracks()[0];
      const audio = this.localStream.getAudioTracks()[0];
      if (!video || !audio) throw new Error(`${srsProvider ? 'SRS' : 'Cloudflare'} publisher requires both video and audio tracks.`);
      if (srsProvider) {
        // SRS RTC-to-RTMP requires H.264 video. Browsers may otherwise
        // negotiate VP8/VP9/AV1, which can establish WebRTC successfully
        // but cannot be converted into the downstream RTMP program.
        const videoTransceiver = this.pc.addTransceiver(video, { direction: 'sendonly' });
        const h264Codecs = (RTCRtpSender.getCapabilities('video')?.codecs || [])
          .filter(codec => codec.mimeType.toLowerCase() === 'video/h264');
        if (!h264Codecs.length || !videoTransceiver.setCodecPreferences) {
          throw new Error('This browser cannot provide an H.264 WebRTC video track required by Testagram SRS.');
        }
        videoTransceiver.setCodecPreferences(h264Codecs);
        this.pc.addTransceiver(audio, { direction: 'sendonly' });
      } else {
        this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream!));
      }
    } else {
      this.pc.addTransceiver('video', { direction: 'recvonly' });
      this.pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIce(this.pc);
    if (!this.pc.localDescription?.sdp) throw new Error('Cloudflare WebRTC offer SDP was not created.');

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp', Accept: 'application/sdp', ...(this.info?.provider?.startsWith('srs-') && this.info?.token ? { Authorization: `Bearer ${this.info.token}` } : {}) },
        body: this.pc.localDescription.sdp,
      });
    } catch {
      throw new Error('Testagram SRS media gateway is unreachable. Check media.testagram.site, HTTPS, and UDP/TCP 8000.');
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 240);
      throw new Error(`SRS WebRTC ${this.role === 'host' ? 'WHIP' : 'WHEP'} negotiation failed (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`);
    }
    const answer = await response.text();
    if (!answer.trim()) throw new Error('SRS WebRTC returned an empty SDP answer.');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });
    this.answerReceived = true;
    this.lastDiagnostics = { ...this.lastDiagnostics, provider: this.info?.provider || 'srs-youtube-hybrid', signaling: 'sdp-answer-received', endpoint: this.role === 'host' ? 'whip' : 'whep' };
    const location = response.headers.get('Location');
    if (location) this.mediaSessionUrl = new URL(location, endpoint).toString();
  };

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
    if (this.roomType === 'tv' && (this.info.provider === 'cloudflare-mux-hybrid' || this.info.provider === 'youtube-cloudflare-hybrid' || this.info.provider === 'srs-youtube-hybrid' || this.info.provider === 'srs-mux-hybrid')) {
      if (this.role === 'host') {
        await this.connectWhipStream();
      } else if (this.role === 'viewer') {
        if (!this.info.playback_url) throw new Error(`${this.info.provider?.startsWith('srs-') ? 'YouTube' : 'Mux'} playback URL is missing [STREAM_PLAYBACK_NOT_READY].`);
        this.lastDiagnostics = { provider: this.info.provider, playback: 'mux-hls', playbackUrlPresent: true };
      }
      return;
    }
    if (this.roomType === 'tv' && this.info.provider === 'mux') {
      if (this.role !== 'viewer' || !this.info.playback_url) throw new Error('Invalid Mux TV transport contract [TV_TRANSPORT_INVALID].');
      this.lastDiagnostics = { provider: this.info.provider, playback: 'mux-hls', playbackUrlPresent: true };
      return;
    }
    if (this.roomType === 'tv' && this.info.provider === 'cloudflare-stream') {
      await this.connectWhipStream();
      return;
    }
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
    if (this.mediaSessionUrl) {
      try { await fetch(this.mediaSessionUrl, { method: 'DELETE' }); } catch {}
      this.mediaSessionUrl = null;
    }
    this.pc?.getSenders().forEach(sender => sender.track?.stop()); await this.pc?.close();
    this.pc = undefined as unknown as RTCPeerConnection;
  }
}
