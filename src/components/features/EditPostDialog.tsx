import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, X } from 'lucide-react';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { toast } from 'sonner';

interface EditPostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: {
    id: string;
    content: string;
    image_url?: string;
  };
  onSuccess: () => void;
}

export function EditPostDialog({ open, onOpenChange, post, onSuccess }: EditPostDialogProps) {
  const [content, setContent] = useState(post.content);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!content.trim()) {
      toast.error('Content cannot be empty');
      return;
    }

    setLoading(true);

    try {
      await backendCapabilities.call('testagram.posts.update', { post_id: post.id, content });
      toast.success('Post updated successfully');
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating post:', error);
      toast.error(error.message || 'Failed to update post');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Post</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What's happening?"
            rows={6}
            maxLength={700}
            className="resize-none"
          />
          <p className="text-sm text-muted-foreground text-right">
            {content.length}/700
          </p>
          
          {post.image_url && (
            <div className="relative rounded-lg overflow-hidden">
              <img 
                src={post.image_url} 
                alt="Post" 
                className="w-full max-h-64 object-cover"
              />
              <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
                Image cannot be edited
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={loading || !content.trim()}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
