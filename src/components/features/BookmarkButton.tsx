import { useState, useEffect } from 'react';
import { Bookmark } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { updateInterestSignal } from '@/services/recommendations';
import { backendCapabilities } from '@/services/backendClient';
import { bookmarkRemote, unbookmarkRemote, remoteBookmarkState } from '@/api/federation';

interface BookmarkButtonProps {
  postId: string;
  onChange?: (bookmarked: boolean) => void;
}

export function BookmarkButton({ postId, onChange }: BookmarkButtonProps) {
  const { user } = useAuth();
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsBookmarked(false);
      return;
    }
    let cancelled = false;
    if (/^https:\/\//i.test(postId)) {
      remoteBookmarkState(postId).then(state => { if (!cancelled) setIsBookmarked(state); }).catch(() => { if (!cancelled) setIsBookmarked(false); });
      return () => { cancelled = true; };
    }
    backendCapabilities.listBookmarks(100).then(({ items }) => {
      if (!cancelled) setIsBookmarked(items.some((item: any) => String(item.post_id ?? item.object_uri ?? item.id) === postId));
    }).catch(() => {
      if (!cancelled) setIsBookmarked(false);
    });
    return () => { cancelled = true; };
  }, [postId, user]);

  const toggleBookmark = async () => {
    if (!user) {
      toast.error('Please log in to bookmark posts');
      return;
    }

    setLoading(true);
    const previous = isBookmarked;
    setIsBookmarked(!previous);

    try {
      if (previous) {
        if (/^https:\/\//i.test(postId)) await unbookmarkRemote(postId);
        else await backendCapabilities.removeBookmark(postId);
        onChange?.(false);
        toast.success('Removed from bookmarks');
      } else {
        if (/^https:\/\//i.test(postId)) await bookmarkRemote(postId);
        else await backendCapabilities.bookmarkPost(postId);
        toast.success('Added to bookmarks');
        onChange?.(true);
        updateInterestSignal(user.id, postId, 'bookmark').catch(() => {});
      }
    } catch (error: any) {
      setIsBookmarked(previous);
      toast.error(error.message || 'Bookmark update failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={toggleBookmark}
      disabled={loading}
      className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors group"
    >
      <Bookmark
        className={`w-5 h-5 group-hover:scale-110 transition-transform ${
          isBookmarked ? 'fill-primary text-primary' : ''
        }`}
      />
    </button>
  );
}
