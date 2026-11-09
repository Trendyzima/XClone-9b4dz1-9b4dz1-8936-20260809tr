import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { createPost, MAX_POST_BODY_LENGTH } from '@/services/posts';

type ComposePostProps = {
  communityId?: string;
  onSuccess?: () => void | Promise<void>;
};

const MAX_ATTACHMENTS = 4;

export function ComposePost({ communityId, onSuccess }: ComposePostProps) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!selected.length) return;
    setFiles((current) => {
      const next = [...current, ...selected].slice(0, MAX_ATTACHMENTS);
      if (current.length + selected.length > MAX_ATTACHMENTS) {
        toast.info(`A post can contain up to ${MAX_ATTACHMENTS} attachments.`);
      }
      return next;
    });
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!body.trim() && files.length === 0) {
      toast.error('Write something or attach media before posting.');
      return;
    }
    setSubmitting(true);
    try {
      await createPost({ body, media: files, communityId: communityId ?? null });
      setBody('');
      setFiles([]);
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
        onChange={(event) => setBody(event.target.value.slice(0, MAX_POST_BODY_LENGTH))}
        placeholder="What is happening?"
        aria-label="Post text"
        maxLength={MAX_POST_BODY_LENGTH}
        rows={3}
        disabled={submitting}
        className="min-h-24 resize-y border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
      />

      {previews.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {previews.map((preview, index) => (
            <div key={preview} className="relative overflow-hidden rounded-lg border border-border">
              <img src={preview} alt={files[index]?.name ?? `Attachment ${index + 1}`} className="h-28 w-full object-cover" />
              <button
                type="button"
                onClick={() => removeFile(index)}
                disabled={submitting}
                aria-label={`Remove attachment ${index + 1}`}
                className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white hover:bg-black"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/webm"
            multiple
            onChange={addFiles}
            className="sr-only"
            aria-label="Choose images or videos"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={submitting || files.length >= MAX_ATTACHMENTS}
            aria-label="Attach images or videos"
          >
            <ImagePlus className="mr-2 h-4 w-4" />
            Media
          </Button>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {body.length}/{MAX_POST_BODY_LENGTH}
          </span>
        </div>
        <Button type="submit" size="sm" disabled={submitting || (!body.trim() && files.length === 0)}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {submitting ? 'Publishing…' : 'Post'}
        </Button>
      </div>
    </form>
  );
}

export default ComposePost;
