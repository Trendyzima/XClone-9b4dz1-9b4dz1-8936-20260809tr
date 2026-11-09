import { useState, type FormEvent } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { createPost, MAX_POST_BODY_LENGTH } from '@/services/posts';

type ComposePostProps = {
  communityId?: string;
  onSuccess?: () => void | Promise<void>;
};

export function ComposePost({ communityId, onSuccess }: ComposePostProps) {
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const communityPostingUnavailable = Boolean(communityId?.trim());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || communityPostingUnavailable) return;
    if (!body.trim()) {
      toast.error('Write something before publishing.');
      return;
    }
    setSubmitting(true);
    try {
      await createPost({ body });
      setBody('');
      toast.success('Your post has been published.');
      try {
        await onSuccess?.();
      } catch {
        // Publishing succeeded; a feed refresh failure must not report a failed post.
        toast.info('Your post is live. Refresh the feed to see the latest updates.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not publish your post.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 p-4" aria-label="Create a post">
      <Textarea
        value={body}
        onChange={(event) => {
          const next = Array.from(event.target.value).slice(0, MAX_POST_BODY_LENGTH).join('');
          setBody(next);
        }}
        placeholder={communityPostingUnavailable ? 'Community publishing is being migrated to the Backend API.' : 'What is happening?'}
        aria-label="Post text"
        rows={3}
        disabled={submitting || communityPostingUnavailable}
        className="min-h-24 resize-y border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
      />
      {communityPostingUnavailable && (
        <p role="status" className="text-xs text-muted-foreground">
          Community posts are paused until the native community API is available. Your text will not be sent to a legacy database.
        </p>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {Array.from(body).length}/{MAX_POST_BODY_LENGTH}
        </span>
        <Button type="submit" size="sm" disabled={submitting || communityPostingUnavailable || !body.trim()}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {submitting ? 'Publishing…' : 'Post'}
        </Button>
      </div>
    </form>
  );
}

export default ComposePost;
