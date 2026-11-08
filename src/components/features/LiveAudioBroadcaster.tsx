import { Radio } from 'lucide-react';

interface LiveAudioBroadcasterProps {
  spaceId: string;
  isHost: boolean;
  onBroadcastStart?: (url: string) => void;
  onBroadcastStop?: () => void;
}

/**
 * Live audio publishing remains disabled until Data Centre exposes an
 * authenticated SFU/media-ingest API and Backend issues scoped space tickets.
 * The old implementation wrote recordings and signaling state directly to
 * Supabase from the browser, which is not permitted in the five-repository
 * architecture.
 */
export function LiveAudioBroadcaster({ spaceId, isHost }: LiveAudioBroadcasterProps) {
  if (!isHost) return null;
  return (
    <div role="status" data-space-id={spaceId} className="rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground flex items-center gap-2">
      <Radio className="w-4 h-4 shrink-0" />
      Live audio publishing is waiting for the Backend/Data Centre media transport.
    </div>
  );
}
