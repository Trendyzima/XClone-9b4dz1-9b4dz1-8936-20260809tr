type YouTubeSessionStatus = 'connecting' | 'encoding' | 'reconnecting' | 'stopped';

type YouTubeSessionOptions = {
  streamId: string;
  encoderToken?: string;
  ingestConfig?: { rtmpsIngestionAddress: string; streamName: string };
  program: MediaStream;
  videoBitsPerSecond: number;
  onStatus?: (status: YouTubeSessionStatus, detail?: string) => void;
};

const socketUrl = (streamId: string, encoderToken?: string, ingestConfig?: { rtmpsIngestionAddress: string; streamName: string }) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return protocol + '//' + window.location.host + '/api/tv-youtube-ingest?stream_id=' +
    encodeURIComponent(streamId) + (encoderToken ? '&encoder_token=' + encodeURIComponent(encoderToken) : '') + (ingestConfig ? '&rtmps_ingestion_address=' + encodeURIComponent(ingestConfig.rtmpsIngestionAddress) + '&stream_name=' + encodeURIComponent(ingestConfig.streamName) : '');
};

const pickMime = () => [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
].find(type => MediaRecorder.isTypeSupported(type)) || '';

// Production transport: WebM chunks -> Vercel encoder -> YouTube RTMPS.
export class TestagramTvYouTubeSession {
  private readonly options: YouTubeSessionOptions;
  private socket: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private stopped = false;
  private rotating = false;
  private reconnectTimer: number | null = null;
  private rotationTimer: number | null = null;
  private connectPromise: Promise<void> | null = null;
  private status: YouTubeSessionStatus = 'connecting';

  private constructor(options: YouTubeSessionOptions) {
    this.options = options;
  }

  static async connect(options: YouTubeSessionOptions) {
    const session = new TestagramTvYouTubeSession(options);
    await session.openTransport();
    session.rotationTimer = window.setTimeout(() => void session.rotateTransport(), 240_000);
    return session;
  }

  private setStatus(status: YouTubeSessionStatus, detail?: string) {
    this.status = status;
    this.options.onStatus?.(status, detail);
  }

  private async openTransport(): Promise<void> {
    if (this.stopped) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(socketUrl(this.options.streamId, this.options.encoderToken, this.options.ingestConfig));
      this.socket = socket;
      socket.binaryType = 'arraybuffer';
      let settled = false;

      const fail = (message: string) => {
        if (!settled) {
          settled = true;
          reject(new Error(message));
        }
      };

      socket.onopen = () => {
        this.setStatus('connecting');
      };

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
          fail(message.message || 'YouTube encoder rejected the stream.');
        }
      };

      socket.onerror = () => fail('YouTube encoder connection failed.');
      socket.onclose = () => {
        this.socket = null;
        this.stopRecorder();
        if (!this.stopped && !this.rotating) {
          this.setStatus('reconnecting');
          this.reconnectTimer = window.setTimeout(() => {
            this.connectPromise = null;
            void this.openTransport().catch(() => undefined);
          }, 1500);
        } else if (!settled) {
          fail('YouTube encoder connection closed before it became ready.');
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
    if (!mimeType) throw new Error('This browser cannot encode a WebM live contribution for the YouTube encoder.');
    const recorder = new MediaRecorder(this.options.program, {
      mimeType,
      videoBitsPerSecond: this.options.videoBitsPerSecond,
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
    this.socket?.close(1000, 'scheduled transport rotation');
    this.socket = null;
    await new Promise(resolve => window.setTimeout(resolve, 250));
    this.rotating = false;
    if (!this.stopped) {
      await this.openTransport();
      this.rotationTimer = window.setTimeout(() => void this.rotateTransport(), 240_000);
    }
  }

  getStatus() { return this.status; }
  getDiagnostics() { return { provider: 'youtube', status: this.status, streamId: this.options.streamId }; }
  async stopBroadcastControlPlane() { /* Control-plane stop is handled by the Studio after transport shutdown. */ }

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
