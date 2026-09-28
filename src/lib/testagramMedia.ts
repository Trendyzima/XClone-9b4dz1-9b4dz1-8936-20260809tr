import { supabase } from '@/lib/supabase';

export type MediaRole = 'host' | 'viewer' | 'guest';

type MediaToken = {
  token: string;
  ws_url: string;
  stream_id: string;
  role: MediaRole;
};

type Signal = {
  type: 'offer' | 'answer' | 'candidate';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  viewer_count?: number;
  guest_count?: number;
};

const waitForIce = async (pc: RTCPeerConnection) => {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>(resolve => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', done);
      resolve();
    };
    pc.addEventListener('icegatheringstatechange', done);
    window.setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', done);
      resolve();
    }, 4000);
  });
};

const getToken = async (streamId: string, role: MediaRole, inviteToken?: string): Promise<MediaToken> => {
  const body = { stream_id: streamId, role, invite_token: inviteToken || undefined };
  const { data, error } = await supabase.functions.invoke('testagram-media-token', { body });
  if (error || !data?.data?.token || !data?.data?.ws_url) {
    throw new Error(data?.error?.message || error?.message || 'Testagram Media Engine is not configured.');
  }
  return data.data as MediaToken;
};

export class TestagramMediaSession {
  readonly role: MediaRole;
  readonly streamId: string;
  readonly pc: RTCPeerConnection;
  private ws: WebSocket | null = null;
  private closed = false;
  private onRemoteStream?: (stream: MediaStream) => void;
  private onRemoteTrack?: (track: MediaStreamTrack) => void;
  private onViewerCount?: (count: number, guests: number) => void;

  private constructor(role: MediaRole, streamId: string, pc: RTCPeerConnection) {
    this.role = role;
    this.streamId = streamId;
    this.pc = pc;
  }

  static async connectHost(streamId: string, program: MediaStream): Promise<TestagramMediaSession> {
    const info = await getToken(streamId, 'host');
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const session = new TestagramMediaSession('host', streamId, pc);
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    session.bindRemoteTracks();
    program.getTracks().forEach(track => pc.addTrack(track, program));
    await session.connect(info);
    return session;
  }

  static async connectViewer(streamId: string, onRemoteStream: (stream: MediaStream) => void): Promise<TestagramMediaSession> {
    const info = await getToken(streamId, 'viewer');
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const session = new TestagramMediaSession('viewer', streamId, pc);
    session.onRemoteStream = onRemoteStream;
    session.bindRemoteTracks();
    const remote = new MediaStream();
    pc.ontrack = event => {
      event.streams[0]?.getTracks().forEach(track => {
        if (!remote.getTracks().some(existing => existing.id === track.id)) remote.addTrack(track);
        session.onRemoteTrack?.(track);
      });
      session.onRemoteStream?.(remote);
    };
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    await session.connect(info);
    return session;
  }

  static async connectGuest(streamId: string, inviteToken: string, onRemoteStream?: (stream: MediaStream) => void): Promise<TestagramMediaSession> {
    const info = await getToken(streamId, 'guest', inviteToken);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const session = new TestagramMediaSession('guest', streamId, pc);
    session.onRemoteStream = onRemoteStream;
    await session.connect(info);
    return session;
  }

  setRemoteTrackHandler(handler: (track: MediaStreamTrack) => void) {
    this.onRemoteTrack = handler;
  }

  setViewerCountHandler(handler: (count: number, guests: number) => void) {
    this.onViewerCount = handler;
  }

  bindRemoteTracks() {
    this.pc.ontrack = event => {
      const track = event.track;
      this.onRemoteTrack?.(track);
      const stream = event.streams[0] || new MediaStream([track]);
      this.onRemoteStream?.(stream);
    };
  }

  async publishTracks(stream: MediaStream) {
    stream.getTracks().forEach(track => this.pc.addTrack(track, stream));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIce(this.pc);
    if (this.ws?.readyState === WebSocket.OPEN && this.pc.localDescription) {
      this.ws.send(JSON.stringify({ type: 'offer', sdp: this.pc.localDescription.sdp }));
    }
  }

  private async connect(existingInfo?: MediaToken) {
    const info = existingInfo || await getToken(this.streamId, this.role);
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(info.ws_url + (info.ws_url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(info.token));
      this.ws = ws;
      const timeout = window.setTimeout(() => reject(new Error('Testagram Media Engine connection timed out.')), 12000);
      ws.onopen = async () => {
        window.clearTimeout(timeout);
        try {
          if (this.role === 'viewer' || this.role === 'host') {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            await waitForIce(this.pc);
            if (this.pc.localDescription) ws.send(JSON.stringify({ type: 'offer', sdp: this.pc.localDescription.sdp }));
            if (this.role === 'viewer') resolve();
          } else {
            resolve();
          }
        } catch (e) {
          reject(e);
        }
      };
      ws.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Could not connect to Testagram Media Engine.'));
      };
      ws.onclose = () => {
        if (!this.closed) this.onRemoteStream?.(new MediaStream());
      };
      ws.onmessage = async event => {
        try {
          const message = JSON.parse(event.data) as Signal;
          if (message.type === 'answer' && message.sdp) {
            await this.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
            resolve();
          } else if (message.type === 'offer' && message.sdp) {
            await this.pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            await waitForIce(this.pc);
            if (this.pc.localDescription) ws.send(JSON.stringify({ type: 'answer', sdp: this.pc.localDescription.sdp }));
            resolve();
          } else if (message.type === 'candidate' && message.candidate) {
            await this.pc.addIceCandidate(message.candidate);
          } else if (message.type === 'presence') {
            this.onViewerCount?.(Number(message.viewer_count || 0), Number(message.guest_count || 0));
          }
        } catch (e) {
          console.warn('[Testagram Media Engine] signaling error', e);
        }
      };
      this.pc.onicecandidate = event => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate.toJSON() }));
        }
      };
    });
  }

  async close() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.pc.getSenders().forEach(sender => sender.track?.stop());
    this.pc.close();
  }
}
