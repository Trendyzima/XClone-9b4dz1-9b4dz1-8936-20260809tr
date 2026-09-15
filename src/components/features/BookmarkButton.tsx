import { useState, useEffect } from 'react';
import { Bookmark } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { updateInterestSignal } from '@/services/recommendations';
import { backendCapabilities } from '@/services/backendClient';

interface BookmarkButtonProps {
  postId: string;
}

export function BookmarkButton({ postId }: BookmarkButtonProps) {
  const { user } = useAuth();
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsBookmarked(false);
      return;
    }
    let cancelled = false;
    supabase
      .from('bookmarks')
      .select('post_id')
      .eq('post_id', postId)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setIsBookmarked(!!data);
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
        await backendCapabilities.removeBookmark(postId);
        toast.success('Removed from bookmarks');
      } else {
        await backendCapabilities.bookmarkPost(postId);
        toast.success('Added to bookmarks');
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
