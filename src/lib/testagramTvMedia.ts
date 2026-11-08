/**
 * TV media transport placeholder.
 *
 * The previous implementation used Supabase Realtime as a browser-owned
 * signaling bus. That violates the five-repository boundary. The current
 * Data Centre realtime Worker supports authenticated call signaling, not the
 * multi-party SFU/guest-control protocol required by TV. Do not reconnect this
 * client to Supabase or let it mint anonymous sessions. TV broadcast/playback
 * must remain disabled until Backend issues scoped room tickets and Data
 * Centre exposes a supported SFU transport.
 */
export class TestagramTvMediaSession {
  readonly role: 'host' | 'viewer' | 'guest';
  readonly roomId: string;
  guestSlot = 0;
  private constructor(role: 'host' | 'viewer' | 'guest', roomId: string) { this.role = role; this.roomId = roomId; }
  private static unavailable(): never {
    throw new Error('Testagram TV media transport is temporarily unavailable while the Backend/Data Centre SFU API is being integrated.');
  }
  static async connectHost(_streamId: string, _program: MediaStream): Promise<TestagramTvMediaSession> { return this.unavailable(); }
  static async connectHostExisting(_streamId: string, _program: MediaStream): Promise<TestagramTvMediaSession> { return this.unavailable(); }
  static async connectHostGuestBridge(_streamId: string, _program: MediaStream): Promise<TestagramTvMediaSession> { return this.unavailable(); }
  static async connectViewer(_streamId: string, _onRemoteStream: (stream: MediaStream) => void): Promise<TestagramTvMediaSession> { return this.unavailable(); }
  static async connectGuest(_streamId: string, _inviteToken: string, _localStream?: MediaStream, _onRemoteStream?: (stream: MediaStream) => void): Promise<TestagramTvMediaSession> { return this.unavailable(); }
  setGuestControlHandler(_handler: (control: any) => void) {}
  setGuestSignalHandler(_handler: (signal: any, guestSlot: number) => void) {}
  setRemoteTrackHandler(_handler: (...args: any[]) => void) {}
  setRemotePeerLeaveHandler(_handler: (...args: any[]) => void) {}
  setViewerCountHandler(_handler: (count: number, guests: number) => void) {}
  async sendGuestControl(_slot: number, _control: any) { return this.unavailable(); }
  async sendGuestSignal(_signal: any) { return this.unavailable(); }
  async configureVideoSender(_options: { maxBitrate: number; maxFramerate?: number; maintainResolution?: boolean }) { return this.unavailable(); }
  async waitForMediaReady(_direction: 'send' | 'receive', _timeoutMs?: number) { return this.unavailable(); }
  async verifyOnAir() { return this.unavailable(); }
  async stopBroadcastControlPlane() { return this.unavailable(); }
  async collectNetworkDiagnostics() { return this.unavailable(); }
  getDiagnostics() { return { enabled: false, reason: 'backend-data-centre-sfu-not-ready' }; }
  getStatus() { return 'unavailable'; }
  getPlaybackUrl() { return null; }
  getViewerCount() { return 0; }
  getPeerConnection(): RTCPeerConnection | null { return null; }
  async recover() { return this.unavailable(); }
  async requestReconnect() { return this.unavailable(); }
  async close() {}
}
