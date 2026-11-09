/**
 * Peer-to-peer TV segment exchange is intentionally disabled in XClone.
 *
 * Signaling used to depend on a browser database realtime channel. That
 * bypasses the five-repository API boundary. Data Centre must provide an
 * authenticated Backend-mediated signaling contract before peer sharing can
 * be enabled again. Callers receive a cache miss and continue from origin.
 */
export type PeerSegment = {
  url: string;
  bytes: ArrayBuffer;
  contentType: string;
  originVerified: boolean;
};
type PeerCache = (url: string, requireOrigin?: boolean) => Promise<PeerSegment | null>;

export async function fetchVirtualPeerSegment(
  _streamUrl: string,
  _segmentUrl: string,
  _cache: PeerCache,
): Promise<PeerSegment | null> {
  return null;
}

export function closeVirtualPeerRooms(): void {
  // No browser-owned signaling rooms are opened.
}
