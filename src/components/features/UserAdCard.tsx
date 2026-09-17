import { TestagramAdSlot, TestagramAdContext } from './TestagramAdSlot';

interface UserAdCardProps {
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
}

/**
 * Legacy-compatible Facebook-style ad surface.
 * All serving, frequency, eligibility, impressions and clicks now belong to Testagram Ads.
 */
export function UserAdCard({ ad }: UserAdCardProps) {
  const context: TestagramAdContext = {
    content_id: ad.source_id ?? undefined,
    content_type: ad.source_type ?? 'post',
    author_id: ad.author_id ?? undefined,
  };
  return <TestagramAdSlot placement={ad.video_url ? 'VIDEO_FEED' : 'HOME_FEED'} context={context} />;
}
