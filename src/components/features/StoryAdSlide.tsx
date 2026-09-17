import { useEffect } from 'react';
import { TestagramAdSlot } from './TestagramAdSlot';

export interface StoryAdData {
  id: string;
  title?: string;
  description?: string;
  image_url?: string | null;
  video_url?: string | null;
  target_url?: string | null;
  campaignId?: string;
  creativeId?: string;
  eventToken?: string;
  source_id?: string | null;
  source_type?: string | null;
  author_id?: string | null;
}
interface StoryAdSlideProps { ad: StoryAdData; onComplete: () => void; onSkip: () => void; }

/** Compatibility surface for stories. Serving and measurement come from Testagram Ads. */
export function StoryAdSlide({ ad, onComplete }: StoryAdSlideProps) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, 8000);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  return (
    <TestagramAdSlot
      placement="STORIES"
      context={{
        content_id: ad.source_id ?? undefined,
        content_type: ad.source_type ?? 'story',
        author_id: ad.author_id ?? undefined,
      }}
      className="rounded-none border-0 min-h-[100svh] bg-black"
    />
  );
}
