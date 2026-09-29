import { supabase } from '@/lib/supabase';

type TvRole = 'host' | 'viewer' | 'guest';
type Signal = { from: string; to?: string; peerRole?: TvRole; sdp?: string; candidate?: RTCIceCandidateInit; count?: number; guestCount?: number };
type VideoOptions = { maxBitrate: number; maxFramerate?: number; maintainResolution?: boolean };

const tvApi = () => {
  const origin = window.location.origin === 'https://testagram.site' ? 'https://www.testagram.site' : window.location.origin;
  return origin + '/api/live';
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
  private remoteStream = new MediaStream();
  private closed = false;
  private peerId = crypto.randomUUID();
  private onRemoteStream?: (stream: MediaStream) => void;
  private onRemoteTrack?: (track: MediaStreamTrack) => void;
  private onViewerCount?: (count: number, guests: number) => void;
  private videoOptions: VideoOptions | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve?: () => void;
  private lastDiagnostics: Record<string, unknown> = {};

  private constructor(role: TvRole, roomId: string) { this.role = role; this.roomId = roomId; }

  static async connectHost(streamId: string, program: MediaStream) {
    const session = new TestagramTvMediaSession('host', streamId);
    session.localStream = program;
    await session.start('start');
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

  private async start(action: 'start' | 'viewer' | 'guest') {
    const data = await api({ action, stream_id: this.roomId, invite_token: action === 'guest' ? this.guestToken : undefined });
    this.topic = data.signaling_topic;
    this.channel = supabase.channel(this.topic, { config: { broadcast: { ack: true, self: false } } });

    this.channel
      .on('broadcast', { event: 'tv-join' }, payload => void this.onJoin(payload.payload as Signal))
      .on('broadcast', { event: 'tv-offer' }, payload => void this.onOffer(payload.payload as Signal))
      .on('broadcast', { event: 'tv-answer' }, payload => void this.onAnswer(payload.payload as Signal))
      .on('broadcast', { event: 'tv-candidate' }, payload => void this.onCandidate(payload.payload as Signal))
      .on('broadcast', { event: 'tv-leave' }, payload => void this.onLeave(payload.payload as Signal))
      .on('broadcast', { event: 'tv-presence' }, payload => {
        const p = payload.payload as Signal;
        this.onViewerCount?.(Number(p.count || 0), Number(p.guestCount || 0));
      });

    await new Promise<void>((resolve, reject) => {
      this.channel!.subscribe(status => {
        if (status === 'SUBSCRIBED') resolve();
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`TV signaling channel ${status.toLowerCase()}.`));
      });
    });

    this.lastDiagnostics = { provider: 'native-p2p', signaling: 'supabase-realtime', topic: this.topic, peerId: this.peerId };

    if (this.role !== 'host') {
      await this.send({ event: 'tv-join', payload: { from: this.peerId, peerRole: this.role } });
      this.readyPromise = new Promise<void>(resolve => { this.readyResolve = resolve; });
    } else {
      this.lastDiagnostics = { ...this.lastDiagnostics, programTracks: this.localStream?.getTracks().map(t => t.kind) || [] };
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
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    this.peers.set(peerId, pc);
    this.peerRoles.set(peerId, peerRole);

    pc.onicecandidate = e => {
      if (e.candidate) void this.send({ event: 'tv-candidate', payload: { from: this.peerId, to: peerId, candidate: e.candidate.toJSON() } });
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState) && !this.closed) {
        this.peers.delete(peerId);
        this.peerRoles.delete(peerId);
        this.publishPresence();
      }
    };
    pc.ontrack = e => {
      if (!this.remoteStream.getTracks().some(t => t.id === e.track.id)) this.remoteStream.addTrack(e.track);
      this.onRemoteTrack?.(e.track);
      this.onRemoteStream?.(this.remoteStream);
      this.readyResolve?.();
      this.readyResolve = undefined;
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
    this.peerRoles.delete(message.from);
    this.publishPresence();
  }

  private publishPresence() {
    if (this.role !== 'host') return;
    let viewers = 0, guests = 0;
    for (const role of this.peerRoles.values()) role === 'guest' ? guests++ : viewers++;
    void this.send({ event: 'tv-presence', payload: { from: this.peerId, count: viewers, guestCount: guests } }).catch(() => undefined);
    this.onViewerCount?.(viewers, guests);
  }

  setRemoteTrackHandler(handler: (track: MediaStreamTrack) => void) { this.onRemoteTrack = handler; }
  setViewerCountHandler(handler: (count: number, guests: number) => void) { this.onViewerCount = handler; }

  async configureVideoSender(options: VideoOptions) {
    this.videoOptions = options;
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
    if (this.readyPromise) {
      await Promise.race([this.readyPromise, new Promise((_, reject) => window.setTimeout(() => reject(new Error(`TV media did not arrive within ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs))]);
    }
    const pc = Array.from(this.peers.values())[0];
    if (!pc) throw new Error('TV viewer is waiting for the broadcaster.');
    this.lastDiagnostics = { ...this.lastDiagnostics, mediaReady: true, connectionState: pc.connectionState };
    return this.lastDiagnostics;
  }

  async verifyOnAir() {
    const data = await api({ action: 'verify', stream_id: this.roomId });
    return data;
  }

  async stopBroadcastControlPlane() {
    if (this.role === 'host') await api({ action: 'stop', stream_id: this.roomId });
  }

  getDiagnostics() { return { ...this.lastDiagnostics }; }
  getPlaybackUrl() { return null; }
  getViewerCount() { return Number(this.lastDiagnostics.viewerCount || 0); }

  async close() {
    if (this.closed) return;
    this.closed = true;
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
