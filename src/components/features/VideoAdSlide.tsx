import { TestagramAdSlot } from './TestagramAdSlot';

interface VideoAdSlideProps {
  ad: {
    id: string;
    title?: string;
    description?: string;
    image_url?: string | null;
    video_url?: string | null;
    target_url?: string | null;
    source_id?: string | null;
    source_type?: string | null;
    author_id?: string | null;
  };
  isActive: boolean;
}

/** Compatibility surface for the video feed. Testagram owns serving and canonical event recording. */
export function VideoAdSlide({ ad, isActive }: VideoAdSlideProps) {
  if (!isActive) return null;
  return (
    <TestagramAdSlot
      placement="VIDEO_FEED"
      context={{
        content_id: ad.source_id ?? undefined,
        content_type: ad.source_type ?? 'video',
        author_id: ad.author_id ?? undefined,
      }}
      className="rounded-none border-0 min-h-[70svh] bg-black"
    />
  );
}
