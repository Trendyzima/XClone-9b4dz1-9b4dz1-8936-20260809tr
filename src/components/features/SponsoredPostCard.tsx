import { TestagramAdSlot } from './TestagramAdSlot';

interface SponsoredPostCardProps {
  post: any;
}

/** Compatibility wrapper: sponsored post inventory is served and measured by Testagram Ads. */
export function SponsoredPostCard({ post }: SponsoredPostCardProps) {
  return (
    <TestagramAdSlot
      placement="HOME_FEED"
      context={{
        content_id: typeof post?.content_id === 'string' ? post.content_id : undefined,
        content_type: typeof post?.content_type === 'string' ? post.content_type : 'post',
        author_id: typeof post?.author_id === 'string' ? post.author_id : undefined,
      }}
      className="border-b border-border rounded-none"
    />
  );
}
