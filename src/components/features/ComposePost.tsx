import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { backendCapabilities } from '@/services/backendClient';
import { socialApi } from '@/services/socialApiClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';

type ComposePostProps = { onSuccess?: () => void; communityId?: string };

/**
 * Native Appwrite -> Backend composer.
 * This replacement deliberately supports text posts only until the Backend
 * exposes verified community/media/poll/quote transaction contracts.
 * It never silently publishes a community post into the public timeline.
 */
export function ComposePost({ onSuccess, communityId }: ComposePostProps) {
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const publish = async () => {
    const text = content.trim();
    if (!user) { toast.error('Sign in to publish.'); return; }
    if (!text) return;
    if (communityId) {
      toast.error('Community publishing is not enabled until the Backend community-post contract is available.');
      return;
    }
    setLoading(true);
    try {
      const moderation = await socialApi.moderateContent(text);
      if (moderation.action !== 'pass') {
        toast.error(moderation.reason || 'This post requires moderation review.');
        return;
      }
      await backendCapabilities.createPost({
        content: text,
        visibility: 'public',
        idempotencyKey: crypto.randomUUID(),
      });
      setContent('');
      toast.success('Post published.');
      onSuccess?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not publish this post.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={user ? "What's happening?" : 'Sign in to publish'}
        maxLength={5000}
        disabled={!user || loading}
        aria-label="Post content"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{content.length}/5000</span>
        <Button onClick={publish} disabled={!user || loading || !content.trim()}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Publish
        </Button>
      </div>
    </section>
  );
}
