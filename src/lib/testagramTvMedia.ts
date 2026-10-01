import { supabase } from '@/lib/supabase';

type TvRole = 'host' | 'viewer' | 'guest';
type Signal = { from: string; to?: string; peerRole?: TvRole; guestSlot?: number; toGuestSlot?: number; control?: 'mute' | 'unmute' | 'block' | 'unblock'; sdp?: string; candidate?: RTCIceCandidateInit; count?: number; guestCount?: number; videoBytes?: number; audioBytes?: number; videoPackets?: number; audioPackets?: number; width?: number; height?: number };
type VideoOptions = { maxBitrate: number; maxFramerate?: number; maintainResolution?: boolean };
type TvNetworkProfile = 'excellent' | 'good' | 'constrained' | 'poor';

const tvApi = () => {
  const origin = window.location.origin === 'https://testagram.site' ? 'https://www.testagram.site' : window.location.origin;
  return origin + '/api/live';
};

const ensureRealtimeAuth = async (required: boolean) => {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    await supabase.realtime.setAuth(data.session.access_token);
    return data.session;
  }
  if (!required) return null;
  const { data: anonymous, error } = await supabase.auth.signInAnonymously();
  if (error || !anonymous.session) {
    throw new Error('TV viewer authorization is unavailable. Enable Supabase Anonymous Sign-Ins or sign in to Testagram.');
  }
  await supabase.realtime.setAuth(anonymous.session.access_token);
  return anonymous.session;
};

const api = async (body: Record<string, unknown>) => {
  const { data } = await supabase.auth.getSession();
  const response = await fetch(tvApi(), {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'TV control request failed.');
  return payload?.data;
};

const waitForIce = async (pc: RTCPeerConnection) => {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>(resolve => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', done); resolve(); };
    pc.addEventListener('icegatheringstatechange', done);
    window.setTimeout(() => { pc.removeEventListener('icegatheringstatechange', done); resolve(); }, 5000);
  });
};

export class TestagramTvMediaSession {
  readonly role: TvRole;
  readonly roomId: string;
  private topic = '';
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private localStream: MediaStream | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private peerRoles = new Map<string, TvRole>();
  private peerGuestSlots = new Map<string, number>();
  private remoteStream = new MediaStream();
  private closed = false;
  private peerId = crypto.randomUUID();
  private onRemoteStream?: (stream: MediaStream) => void;
  private onRemoteTrack?: (track: MediaStreamTrack, peerId: string, guestSlot?: number) => void;
  private onRemotePeerLeave?: (peerId: string, peerRole: TvRole, guestSlot?: number) => void;
  private onViewerCount?: (count: number, guests: number) => void;
  private onGuestControl?: (control: 'mute' | 'unmute' | 'block' | 'unblock') => void;
  private videoOptions: VideoOptions | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve?: () => void;
  private lastDiagnostics: Record<string, unknown> = {};
  private heartbeatTimer: number | null = null;
  private heartbeatInFlight = false;
  private heartbeatState: 'starting' | 'connected' | 'degraded' | 'stale' = 'starting';
  private heartbeatViewerCount = 0;
  private reconnectTimers = new Map<string, number>();
  private adaptationTimer: number | null = null;
  private peerStats = new Map<string, { lastBytes: number; lastLost: number; lastSentPackets: number; lastAt: number; stableSamples: number; profile: TvNetworkProfile }>();
  private inboundMediaReady = false;
  private videoCeilingBitrate = 8_000_000;
  private iceServers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];

  private constructor(role: TvRole, roomId: string) { this.role = role; this.roomId = roomId; }

  static async connectHost(streamId: string, program: MediaStream) {
    const video = program.getVideoTracks()[0];
    const audio = program.getAudioTracks()[0];
    if (!video || video.readyState !== 'live') throw new Error('TV program video track is not live.');
    if (!audio || audio.readyState !== 'live') throw new Error('TV program audio track is not live.');

    const session = new TestagramTvMediaSession('host', streamId);
    session.localStream = program;
    await session.start('start');
    session.lastDiagnostics = {
      ...session.lastDiagnostics,
      mediaReady: true,
      videoTrack: video.readyState,
      audioTrack: audio.readyState,
    };
    return session;
  }

  static async connectHostExisting(streamId: string, program: MediaStream) {
    const video = program.getVideoTracks()[0];
    const audio = program.getAudioTracks()[0];
    if (!video || video.readyState !== 'live') throw new Error('TV program video track is not live.');
    if (!audio || audio.readyState !== 'live') throw new Error('TV program audio track is not live.');
    const session = new TestagramTvMediaSession('host', streamId);
    session.localStream = program;
    await session.start('existing-host');
    session.lastDiagnostics = { ...session.lastDiagnostics, mediaReady: true, videoTrack: video.readyState, audioTrack: audio.readyState };
    return session;
  }

  static async connectHostGuestBridge(streamId: string, program: MediaStream) {
    const session = new TestagramTvMediaSession('host', streamId);
    session.localStream = program;
    await session.startHostGuestBridge();
    return session;
  }

  static async connectViewer(streamId: string, onRemoteStream: (stream: MediaStream) => void) {
    const session = new TestagramTvMediaSession('viewer', streamId);
    session.onRemoteStream = onRemoteStream;
    await session.start('viewer');
    return session;
  }

  static async connectGuest(streamId: string, inviteToken: string, localStream?: MediaStream, onRemoteStream?: (stream: MediaStream) => void) {
    const session = new TestagramTvMediaSession('guest', streamId);
    session.onRemoteStream = onRemoteStream;
    session.guestToken = inviteToken;
    session.localStream = localStream || null;
    await session.start('guest');
    return session;
  }

  private guestToken = '';
  public guestSlot = 0;
  setGuestControlHandler(handler: (control: 'mute' | 'unmute' | 'block' | 'unblock') => void) { this.onGuestControl = handler; }
  async sendGuestControl(slot: number, control: 'mute' | 'unmute' | 'block' | 'unblock') { await this.send({ event: 'tv-guest-control', payload: { from: this.peerId, toGuestSlot: slot, control } }); }

  private async startHostGuestBridge() {
    const realtimeSession = await ensureRealtimeAuth(false);
    const data = await api({ action: 'viewer', stream_id: this.roomId });
    if (Array.isArray(data?.ice_servers) && data.ice_servers.length) {
      this.iceServers = data.ice_servers as RTCIceServer[];
    }
    if (realtimeSession?.access_token) await supabase.realtime.setAuth(realtimeSession.access_token);
    this.topic = data?.signaling_topic || ('tv:' + this.roomId);
    this.channel = supabase.channel(this.topic, {
      config: { broadcast: { ack: true, self: false }, private: true },
    });
    this.channel
      .on('broadcast', { event: 'tv-join' }, payload => void this.onJoin(payload.payload as Signal))
      .on('broadcast', { event: 'tv-offer' }, payload => void this.onOffer(payload.payload as Signal))
      .on('broadcast', { event: 'tv-answer' }, payload => void this.onAnswer(payload.payload as Signal))
      .on('broadcast', { event: 'tv-candidate' }, payload => void this.onCandidate(payload.payload as Signal))
      .on('broadcast', { event: 'tv-leave' }, payload => void this.onLeave(payload.payload as Signal))
      .on('broadcast', { event: 'tv-reconnect' }, payload => void this.onReconnect(payload.payload as Signal))
      .on('broadcast', { event: 'tv-media-received' }, payload => this.onMediaReceived(payload.payload as Signal))
      .on('broadcast', { event: 'tv-guest-control' }, payload => {
        const p = payload.payload as Signal & { toGuestSlot?: number; control?: 'mute' | 'unmute' | 'block' | 'unblock' };
        if (this.role === 'guest' && Number(p.toGuestSlot) === this.guestSlot && p.control) this.onGuestControl?.(p.control);
      });
    await new Promise<void>((resolve, reject) => {
      this.channel!.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') resolve();
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('TV guest signaling channel ' + status.toLowerCase() + (err ? '.' : '')));
      });
    });
    this.lastDiagnostics = { provider: 'mux', guestBridge: true, signaling: 'supabase-realtime', topic: this.topic, peerId: this.peerId };
  }

  private async start(action: 'start' | 'existing-host' | 'viewer' | 'guest') {
    const realtimeSession = await ensureRealtimeAuth(action !== 'start');

    // The host must subscribe to signaling before the control plane marks the
    // stream live. Otherwise a viewer can join in the small window where the
    // database says "live" but the host is not yet listening for tv-join.
    let data: any = null;
    if (action === 'start' || action === 'existing-host') {
      this.topic = `tv:${this.roomId}`;
    } else {
      data = await api({
        action,
        stream_id: this.roomId,
        invite_token: action === 'guest' ? this.guestToken : undefined,
      });
      this.topic = data.signaling_topic;
      if (Array.isArray(data?.ice_servers) && data.ice_servers.length) {
        this.iceServers = data.ice_servers as RTCIceServer[];
      }
      if (action === 'guest') this.guestSlot = Number(data?.guest_slot || 0);
    }

    if (realtimeSession?.access_token) await supabase.realtime.setAuth(realtimeSession.access_token);
    this.channel = supabase.channel(this.topic, {
      config: { broadcast: { ack: true, self: false }, private: true },
    });

    this.channel
      .on('broadcast', { event: 'tv-join' }, payload => void this.onJoin(payload.payload as Signal))
      .on('broadcast', { event: 'tv-offer' }, payload => void this.onOffer(payload.payload as Signal))
      .on('broadcast', { event: 'tv-answer' }, payload => void this.onAnswer(payload.payload as Signal))
      .on('broadcast', { event: 'tv-candidate' }, payload => void this.onCandidate(payload.payload as Signal))
      .on('broadcast', { event: 'tv-leave' }, payload => void this.onLeave(payload.payload as Signal))
      .on('broadcast', { event: 'tv-reconnect' }, payload => void this.onReconnect(payload.payload as Signal))
      .on('broadcast', { event: 'tv-media-received' }, payload => this.onMediaReceived(payload.payload as Signal))
      .on('broadcast', { event: 'tv-presence' }, payload => {
        const p = payload.payload as Signal;
        this.onViewerCount?.(Number(p.count || 0), Number(p.guestCount || 0));
      });

    try {
      await new Promise<void>((resolve, reject) => {
        this.channel!.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') resolve();
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
            reject(new Error(`TV signaling channel ${status.toLowerCase()}.${detail ? ` ${detail}` : ''}`));
          }
        });
      });

      // Only now publish the live state and start host health heartbeats.
      if (action === 'start') {
        data = await api({ action: 'start', stream_id: this.roomId });
      }
    } catch (error) {
      await this.channel?.unsubscribe().catch(() => undefined);
      this.channel = null;
      throw error;
    }

    this.lastDiagnostics = { provider: 'native-p2p', signaling: 'supabase-realtime', topic: this.topic, peerId: this.peerId };

    if (this.role !== 'host') {
      this.readyPromise = new Promise<void>(resolve => { this.readyResolve = resolve; });
      await this.send({ event: 'tv-join', payload: { from: this.peerId, peerRole: this.role, guestSlot: this.role === 'guest' ? this.guestSlot : undefined } });
    } else {
      this.lastDiagnostics = { ...this.lastDiagnostics, programTracks: this.localStream?.getTracks().map(t => t.kind) || [] };
      this.startHeartbeat('starting');
    }
  }
  private async send(message: { event: string; payload: Signal }) {
    if (!this.channel) throw new Error('TV signaling channel is not connected.');
    const result = await this.channel.send({ type: 'broadcast', event: message.event, payload: message.payload });
    if (result === 'error') throw new Error('TV signaling message was rejected.');
  }

  private createPeer(peerId: string, peerRole: TvRole) {
    const existing = this.peers.get(peerId);
    if (existing) existing.close();
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    this.peers.set(peerId, pc);
    this.peerRoles.set(peerId, peerRole);

    pc.onicecandidate = e => {
      if (e.candidate) void this.send({ event: 'tv-candidate', payload: { from: this.peerId, to: peerId, candidate: e.candidate.toJSON() } });
    };
    pc.onconnectionstatechange = () => {
      this.lastDiagnostics = {
        ...this.lastDiagnostics,
        peerConnectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        peerId,
      };
      if (this.role === 'host') {
        const mediaConfirmed = this.lastDiagnostics.mediaReachedViewer === true;
        const state = pc.connectionState === 'connected' && mediaConfirmed ? 'connected'
          : ['failed', 'disconnected'].includes(pc.connectionState) ? 'degraded'
          : 'starting';
        this.startHeartbeat(state);
      }
      if (['failed', 'disconnected'].includes(pc.connectionState) && !this.closed) {
        if (this.role === 'host') {
          void this.restartPeer(peerId);
        } else {
          void this.send({ event: 'tv-reconnect', payload: { from: this.peerId, to: peerId, peerRole: this.role } }).catch(() => undefined);
        }
      }
      if (pc.connectionState === 'closed' && !this.closed) {
        this.peers.delete(peerId);
        this.peerRoles.delete(peerId);
        this.publishPresence();
      }
    };
    pc.oniceconnectionstatechange = () => {
      this.lastDiagnostics = {
        ...this.lastDiagnostics,
        iceConnectionState: pc.iceConnectionState,
      };
    };
    pc.ontrack = e => {
      this.configureReceiverBuffering(pc);

      if (!this.remoteStream.getTracks().some(t => t.id === e.track.id)) this.remoteStream.addTrack(e.track);
      this.onRemoteTrack?.(e.track, peerId, this.peerGuestSlots.get(peerId));
      this.onRemoteStream?.(this.remoteStream);
      if (this.readyResolve) {
        this.readyResolve();
        this.readyResolve = undefined;
      }
    };

    if (this.role === 'host') {
      if (peerRole === 'viewer') {
        for (const track of this.localStream?.getTracks() || []) pc.addTrack(track, this.localStream!);
      } else {
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }
    } else {
      for (const track of this.localStream?.getTracks() || []) pc.addTrack(track, this.localStream!);
    }
    if (this.videoOptions) void this.applyVideoOptions(pc, this.videoOptions);
    return pc;
  }

  private async onJoin(message: Signal) {
    if (this.role !== 'host' || !message.from || message.from === this.peerId) return;
    const peerRole = message.peerRole === 'guest' ? 'guest' : 'viewer';
    if (peerRole === 'guest' && Number.isInteger(message.guestSlot) && Number(message.guestSlot) > 0) this.peerGuestSlots.set(message.from, Number(message.guestSlot));
    const pc = this.createPeer(message.from, peerRole);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIce(pc);
    await this.send({ event: 'tv-offer', payload: { from: this.peerId, to: message.from, sdp: pc.localDescription?.sdp, peerRole } });
    this.publishPresence();
  }

  private async onOffer(message: Signal) {
    if (this.role === 'host' || message.to !== this.peerId || !message.sdp || !message.from) return;
    const pc = this.createPeer(message.from, 'host');
    await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIce(pc);
    await this.send({ event: 'tv-answer', payload: { from: this.peerId, to: message.from, sdp: pc.localDescription?.sdp } });
  }

  private configureReceiverBuffering(pc: RTCPeerConnection) {
    for (const receiver of pc.getReceivers()) {
      if (receiver.track?.kind !== 'video') continue;
      const r = receiver as RTCRtpReceiver & { jitterBufferTarget?: number; playoutDelayHint?: number };
      try { if ('jitterBufferTarget' in r) r.jitterBufferTarget = 1200; } catch {}
      try { if ('playoutDelayHint' in r) r.playoutDelayHint = 1.5; } catch {}
    }
  }

  private async applyAdaptiveDefaults(sender: RTCRtpSender) {
    try {
      const params = sender.getParameters();
      params.encodings ??= [{}];
      for (const encoding of params.encodings) {
        encoding.maxBitrate = Math.min(Number(encoding.maxBitrate || 4_500_000), 4_500_000);
        encoding.maxFramerate = Math.min(Number(encoding.maxFramerate || 30), 30);
      }
      if ('degradationPreference' in params) {
        (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = 'maintain-framerate';
      }
      await sender.setParameters(params);
    } catch {}
  }

  private startAdaptationLoop() {
    if (this.role !== 'host' || this.adaptationTimer !== null) return;
    this.adaptationTimer = window.setInterval(() => void this.adaptPeers(), 5000);
    void this.adaptPeers();
  }

  private async adaptPeers() {
    if (this.role !== 'host' || this.closed) return;
    for (const [peerId, pc] of this.peers) {
      const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (!videoSender) continue;
      try {
        const reports = await pc.getStats();
        let outbound: any = null;
        let remote: any = null;
        reports.forEach(report => {
          if (report.type === 'outbound-rtp' && report.kind === 'video') outbound = report;
          if (report.type === 'remote-inbound-rtp' && report.kind === 'video') remote = report;
        });
        if (!outbound) continue;
        const now = performance.now();
        const previous = this.peerStats.get(peerId);
        const bytes = Number(outbound.bytesSent || 0);
        const lost = Number(remote?.packetsLost || 0);
        const deltaSeconds = previous ? Math.max((now - previous.lastAt) / 1000, 0.1) : 5;
        const bitrate = previous ? ((bytes - previous.lastBytes) * 8) / deltaSeconds : 0;
        const lossDelta = previous ? Math.max(0, lost - previous.lastLost) : 0;
        const sentPackets = Number(outbound.packetsSent || 0);
        const lossRatio = sentPackets > 0 ? lossDelta / Math.max(1, sentPackets - Number(previous?.lastLost || 0) + lossDelta) : 0;
        const rtt = Number(remote?.roundTripTime || 0) * 1000;
        const available = Number(outbound.availableOutgoingBitrate || 0);
        let profile: TvNetworkProfile = 'excellent';
        if (lossRatio > 0.08 || rtt > 500 || (available > 0 && available < 1_500_000)) profile = 'poor';
        else if (lossRatio > 0.03 || rtt > 250 || (available > 0 && available < 3_000_000)) profile = 'constrained';
        else if (lossRatio > 0.01 || rtt > 150 || (available > 0 && available < 5_000_000)) profile = 'good';

        const params = videoSender.getParameters();
        params.encodings ??= [{}];
        const current = Number(params.encodings[0].maxBitrate || 4_500_000);
        const ceiling = this.videoCeilingBitrate;
        const target = profile === 'poor' ? Math.max(900_000, ceiling * 0.25) : profile === 'constrained' ? Math.max(1_500_000, ceiling * 0.45) : profile === 'good' ? Math.max(2_000_000, ceiling * 0.7) : ceiling;
        const next = target < current ? Math.max(target, current * 0.72) : Math.min(target, current * 1.18);
        for (const encoding of params.encodings) {
          encoding.maxBitrate = Math.round(next);
          encoding.maxFramerate = profile === 'poor' ? 20 : profile === 'constrained' ? 24 : 30;
        }
        await videoSender.setParameters(params);
        this.peerStats.set(peerId, { lastBytes: bytes, lastLost: lost, lastSentPackets: sentPackets, lastAt: now, stableSamples: (previous?.stableSamples || 0) + (profile === 'excellent' ? 1 : 0), profile });
        this.lastDiagnostics = { ...this.lastDiagnostics, networkProfile: profile, peerBitrate: Math.round(bitrate), peerRttMs: Math.round(rtt), peerLossRatio: Number(lossRatio.toFixed(4)), peerAvailableBitrate: Math.round(available), adaptiveVideoBitrate: Math.round(next) };
      } catch {}
    }
  }

  private onMediaReceived(message: Signal) {
    if (this.role !== 'host' || !message.from || message.to !== this.peerId) return;
    this.lastDiagnostics = {
      ...this.lastDiagnostics,
      mediaReachedViewer: true,
      viewerVideoBytes: Number(message.videoBytes || 0),
      viewerAudioBytes: Number(message.audioBytes || 0),
      viewerVideoPackets: Number(message.videoPackets || 0),
      viewerAudioPackets: Number(message.audioPackets || 0),
      viewerWidth: Number(message.width || 0),
      viewerHeight: Number(message.height || 0),
    };
    this.startHeartbeat('connected');
  }

  private async onReconnect(message: Signal) {
    if (this.role !== 'host' || message.to !== this.peerId || !message.from) return;
    await this.restartPeer(message.from);
  }

  private async restartPeer(peerId: string) {
    if (this.closed) return;
    const pc = this.peers.get(peerId);
    if (!pc) return;
    try {
      pc.restartIce();
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await waitForIce(pc);
      await this.send({
        event: 'tv-offer',
        payload: {
          from: this.peerId,
          to: peerId,
          sdp: pc.localDescription?.sdp,
          peerRole: this.peerRoles.get(peerId) || 'viewer',
        },
      });
    } catch (error) {
      console.warn('[Testagram TV] WebRTC reconnect failed', error);
    }
  }

  private async onAnswer(message: Signal) {
    if (this.role !== 'host' || message.to !== this.peerId || !message.sdp || !message.from) return;
    const pc = this.peers.get(message.from);
    if (!pc) return;
    await pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
  }

  private async onCandidate(message: Signal) {
    if (message.to !== this.peerId || !message.from || !message.candidate) return;
    const pc = this.peers.get(message.from);
    if (!pc) return;
    try { await pc.addIceCandidate(message.candidate); } catch (error) { console.warn('[Testagram TV] ICE candidate rejected', error); }
  }

  private onLeave(message: Signal) {
    if (!message.from) return;
    const pc = this.peers.get(message.from);
    pc?.close();
    this.peers.delete(message.from);
    const role = this.peerRoles.get(message.from) || 'viewer';
    const guestSlot = this.peerGuestSlots.get(message.from);
    this.peerRoles.delete(message.from);
    this.peerGuestSlots.delete(message.from);
    this.onRemotePeerLeave?.(message.from, role, guestSlot);
    this.publishPresence();
  }

  private publishPresence() {
    if (this.role !== 'host') return;
    let viewers = 0, guests = 0;
    for (const role of this.peerRoles.values()) role === 'guest' ? guests++ : viewers++;
    void this.send({ event: 'tv-presence', payload: { from: this.peerId, count: viewers, guestCount: guests } }).catch(() => undefined);
    this.onViewerCount?.(viewers, guests);
    const mediaConfirmed = this.lastDiagnostics.mediaReachedViewer === true;
    this.startHeartbeat(viewers + guests > 0 && mediaConfirmed ? 'connected' : 'starting', viewers + guests);
  }

  private startHeartbeat(state: 'starting' | 'connected' | 'degraded' | 'stale', viewerCount?: number) {
    if (this.role !== 'host' || this.closed) return;
    this.heartbeatState = state;
    if (typeof viewerCount === 'number') this.heartbeatViewerCount = viewerCount;
    void this.sendHeartbeat();
    if (this.heartbeatTimer !== null) return;
    this.heartbeatTimer = window.setInterval(() => {
      void this.sendHeartbeat();
    }, 10000);
  }

  private async sendHeartbeat() {
    if (this.role !== 'host' || this.closed || this.heartbeatInFlight) return;
    this.heartbeatInFlight = true;
    try {
      const data = await api({
        action: 'heartbeat',
        stream_id: this.roomId,
        connection_state: this.heartbeatState,
        peer_id: this.peerId,
        viewer_count: this.heartbeatViewerCount || this.peers.size,
      });
      this.lastDiagnostics = {
        ...this.lastDiagnostics,
        ...data,
        heartbeat_ok: true,
      };
    } catch (error) {
      this.lastDiagnostics = {
        ...this.lastDiagnostics,
        heartbeat_ok: false,
        heartbeat_error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  setRemoteTrackHandler(handler: (track: MediaStreamTrack, peerId: string, guestSlot?: number) => void) { this.onRemoteTrack = handler; }
  setRemotePeerLeaveHandler(handler: (peerId: string, peerRole: TvRole, guestSlot?: number) => void) { this.onRemotePeerLeave = handler; }
  setViewerCountHandler(handler: (count: number, guests: number) => void) { this.onViewerCount = handler; }

  async configureVideoSender(options: VideoOptions) {
    this.videoOptions = options;
    this.videoCeilingBitrate = Math.min(Math.max(1_000_000, options.maxBitrate), 8_000_000);
    await Promise.all(Array.from(this.peers.values()).map(pc => this.applyVideoOptions(pc, options)));
  }

  private async applyVideoOptions(pc: RTCPeerConnection, options: VideoOptions) {
    for (const sender of pc.getSenders()) {
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
        console.warn('[Testagram TV] sender tuning unavailable', error);
      }
    }
  }

  async waitForMediaReady(direction: 'send' | 'receive', timeoutMs = 20000) {
    if (this.role === 'host' && direction === 'send') {
      const video = this.localStream?.getVideoTracks()[0];
      const audio = this.localStream?.getAudioTracks()[0];
      if (!video || !audio || video.readyState !== 'live' || audio.readyState !== 'live') throw new Error('TV program requires live video and audio tracks.');
      this.lastDiagnostics = { ...this.lastDiagnostics, mediaReady: true, videoTrack: video.readyState, audioTrack: audio.readyState };
      return this.lastDiagnostics;
    }

    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const pc = Array.from(this.peers.values())[0];
      if (!pc) {
        await new Promise<void>(resolve => window.setTimeout(resolve, 100));
        continue;
      }
      const tracks = this.remoteStream.getTracks();
      const hasVideo = tracks.some(track => track.kind === 'video' && track.readyState === 'live');
      const hasAudio = tracks.some(track => track.kind === 'audio' && track.readyState === 'live');
      if (!hasVideo || !hasAudio || pc.connectionState !== 'connected') {
        await new Promise<void>(resolve => window.setTimeout(resolve, 100));
        continue;
      }

      let videoBytes = 0;
      let audioBytes = 0;
      let videoPackets = 0;
      let audioPackets = 0;
      let width = 0;
      let height = 0;
      try {
        const stats = await pc.getStats();
        stats.forEach((report: any) => {
          if (report.type !== 'inbound-rtp') return;
          if (report.kind === 'video') {
            videoBytes += Number(report.bytesReceived || 0);
            videoPackets += Number(report.packetsReceived || 0);
            width = Math.max(width, Number(report.frameWidth || 0));
            height = Math.max(height, Number(report.frameHeight || 0));
          } else if (report.kind === 'audio') {
            audioBytes += Number(report.bytesReceived || 0);
            audioPackets += Number(report.packetsReceived || 0);
          }
        });
      } catch {}

      if (videoBytes > 0 && audioBytes > 0 && videoPackets > 0 && audioPackets > 0) {
        this.inboundMediaReady = true;
        this.lastDiagnostics = {
          ...this.lastDiagnostics,
          mediaReady: true,
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          videoPackets,
          audioPackets,
          videoBytes,
          audioBytes,
          width,
          height,
          mediaReachedViewer: true,
        };
        await this.send({
          event: 'tv-media-received',
          payload: {
            from: this.peerId,
            to: Array.from(this.peers.keys())[0],
            videoBytes,
            audioBytes,
            videoPackets,
            audioPackets,
            width,
            height,
          },
        }).catch(() => undefined);
        return this.lastDiagnostics;
      }
      await new Promise<void>(resolve => window.setTimeout(resolve, 250));
    }
    throw new Error(`TV media did not reach the viewer within ${Math.round(timeoutMs / 1000)}s.`);
  }

  async verifyOnAir() {
    const data = await api({ action: 'verify', stream_id: this.roomId });
    if (!data?.on_air) {
      const state = data?.health?.connection_state || 'unknown';
      const age = Number(data?.health?.heartbeat_age_ms);
      throw new Error(`TV broadcast health check failed (state=${state}, heartbeat=${Number.isFinite(age) ? Math.round(age / 1000) + 's ago' : 'missing'}).`);
    }
    return data;
  }

  async stopBroadcastControlPlane() {
    if (this.role === 'host') await api({ action: 'stop', stream_id: this.roomId });
  }

  async collectNetworkDiagnostics() {
    const peers = await Promise.all(Array.from(this.peers.entries()).map(async ([peerId, pc]) => {
      let inboundVideo = 0;
      let inboundAudio = 0;
      let outboundVideo = 0;
      let outboundAudio = 0;
      try {
        const stats = await pc.getStats();
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp') {
            if (report.kind === 'video') inboundVideo += Number(report.bytesReceived || 0);
            if (report.kind === 'audio') inboundAudio += Number(report.bytesReceived || 0);
          }
          if (report.type === 'outbound-rtp') {
            if (report.kind === 'video') outboundVideo += Number(report.bytesSent || 0);
            if (report.kind === 'audio') outboundAudio += Number(report.bytesSent || 0);
          }
        });
      } catch {}
      return {
        peerId,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        inboundVideoBytes: inboundVideo,
        inboundAudioBytes: inboundAudio,
        outboundVideoBytes: outboundVideo,
        outboundAudioBytes: outboundAudio,
      };
    }));
    this.lastDiagnostics = { ...this.lastDiagnostics, peers };
    return this.getDiagnostics();
  }

  getDiagnostics() { return { ...this.lastDiagnostics }; }
  getStatus() {
    if (this.closed) return 'stopped';
    if (this.heartbeatState === 'connected') return 'encoding';
    if (this.heartbeatState === 'degraded' || this.heartbeatState === 'stale') return 'reconnecting';
    return 'connecting';
  }
  async recover() {
    if (this.closed) return;
    // Native WebRTC peer recovery is already handled by the session's connection
    // state handlers; this method keeps the TV transport lifecycle compatible with
    // the Cloudflare encoder session used by the same studio UI.
  }
  getPlaybackUrl() { return null; }
  getViewerCount() { return Number(this.lastDiagnostics.viewerCount || 0); }

  async requestReconnect() {
    if (this.closed || this.role === 'host') return;
    const hostPeer = Array.from(this.peers.keys())[0];
    if (!hostPeer) return;
    await this.send({ event: 'tv-reconnect', payload: { from: this.peerId, to: hostPeer, peerRole: this.role } }).catch(() => undefined);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.adaptationTimer !== null) {
      window.clearInterval(this.adaptationTimer);
      this.adaptationTimer = null;
    }
    this.peerStats.clear();
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const timer of this.reconnectTimers.values()) window.clearTimeout(timer);
    this.reconnectTimers.clear();
    if (this.channel) {
      await this.send({ event: 'tv-leave', payload: { from: this.peerId } }).catch(() => undefined);
      await supabase.removeChannel(this.channel);
      this.channel = null;
    }
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    this.peerRoles.clear();
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
  }
}
