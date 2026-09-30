type MuxSessionStatus = 'connecting' | 'encoding' | 'reconnecting' | 'stopped';

type MuxSessionOptions = {
  streamId: string;
  encoderToken: string;
  program: MediaStream;
  videoBitsPerSecond: number;
  onStatus?: (status: MuxSessionStatus, detail?: string) => void;
};

const socketUrl = (streamId: string, encoderToken: string) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return protocol + '//' + window.location.host + '/api/tv-mux-ingest?stream_id=' +
    encodeURIComponent(streamId) + '&encoder_token=' + encodeURIComponent(encoderToken);
};

const pickMime = () => [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
].find(type => MediaRecorder.isTypeSupported(type)) || '';

export class TestagramTvMuxSession {
  private readonly options: MuxSessionOptions;
  private socket: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private stopped = false;
  private rotating = false;
  private reconnectTimer: number | null = null;
  private rotationTimer: number | null = null;
  private connectPromise: Promise<void> | null = null;
  private status: MuxSessionStatus = 'connecting';

  private constructor(options: MuxSessionOptions) {
    this.options = options;
  }

  static async connect(options: MuxSessionOptions) {
    const session = new TestagramTvMuxSession(options);
    await session.openTransport();
    session.rotationTimer = window.setTimeout(() => void session.rotateTransport(), 45_000);
    return session;
  }

  private setStatus(status: MuxSessionStatus, detail?: string) {
    this.status = status;
    this.options.onStatus?.(status, detail);
  }

  private async openTransport(): Promise<void> {
    if (this.stopped) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(socketUrl(this.options.streamId, this.options.encoderToken));
      this.socket = socket;
      socket.binaryType = 'arraybuffer';
      let settled = false;

      const fail = (message: string) => {
        if (!settled) {
          settled = true;
          reject(new Error(message));
        }
      };

      socket.onopen = () => this.setStatus('connecting');

      socket.onmessage = event => {
        if (typeof event.data !== 'string') return;
        let message: any = null;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'ready') {
          settled = true;
          this.startRecorder();
          this.setStatus('encoding');
          resolve();
        } else if (message.type === 'error') {
          fail(message.message || 'Mux encoder rejected the stream.');
        }
      };

      socket.onerror = () => fail('Mux encoder connection failed.');
      socket.onclose = () => {
        this.socket = null;
        this.stopRecorder();
        if (!this.stopped && !this.rotating) {
          this.setStatus('reconnecting');
          this.reconnectTimer = window.setTimeout(() => {
            this.connectPromise = null;
            void this.openTransport().catch(() => undefined);
          }, 1000);
        } else if (!settled) {
          fail('Mux encoder connection closed before it became ready.');
        }
      };
    });

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private startRecorder() {
    this.stopRecorder();
    const mimeType = pickMime();
    if (!mimeType) throw new Error('This browser cannot encode a WebM live contribution for the Mux encoder.');
    const recorder = new MediaRecorder(this.options.program, {
      mimeType,
      videoBitsPerSecond: Math.min(this.options.videoBitsPerSecond, 8_000_000),
      audioBitsPerSecond: 128_000,
    });
    recorder.ondataavailable = event => {
      if (!event.data.size || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      if (this.socket.bufferedAmount > 16 * 1024 * 1024) {
        this.socket.close(1013, 'encoder backpressure');
        return;
      }
      this.socket.send(event.data);
    };
    recorder.onerror = () => {
      if (!this.stopped) this.socket?.close(1011, 'browser recorder failed');
    };
    recorder.start(1000);
    this.recorder = recorder;
  }

  private stopRecorder() {
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    }
  }

  private async rotateTransport() {
    if (this.stopped || this.rotating) return;
    this.rotating = true;
    this.setStatus('reconnecting');
    this.stopRecorder();
    this.socket?.close(1000, 'scheduled encoder rotation');
    this.socket = null;
    await new Promise(resolve => window.setTimeout(resolve, 250));
    this.rotating = false;
    if (!this.stopped) {
      await this.openTransport();
      this.rotationTimer = window.setTimeout(() => void this.rotateTransport(), 45_000);
    }
  }

  getStatus() { return this.status; }
  getDiagnostics() {
    return {
      provider: 'mux',
      status: this.status,
      streamId: this.options.streamId,
      transport: 'websocket-webm-ffmpeg-rtmps',
    };
  }

  async stopBroadcastControlPlane() {
    // The Studio calls the TV control-plane stop after closing this transport.
  }

  async close() { await this.stop(); }

  async stop() {
    this.stopped = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.rotationTimer !== null) window.clearTimeout(this.rotationTimer);
    this.stopRecorder();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000, 'broadcast stopped');
    this.setStatus('stopped');
  }
}
