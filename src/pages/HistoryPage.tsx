import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { PostCard } from '@/components/features/PostCard';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Loader2, History, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Post } from '@/types/app-types';

// ── AdSense banner — push-guarded ─────────────────────────────────────────────
import { PageAdBanner } from '@/components/features/AdSenseAd';
function HistoryAdBanner() { return <PageAdBanner />; }

export default function HistoryPage() {
  useSEO({ noindex: true, title: 'Browsing History', url: '/history' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [history, setHistory] = useState<any[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    fetchHistory();
  }, [user]);

  const fetchHistory = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('browsing_history')
        .select(`
          *,
          posts (
            *,
            profiles (*)
          )
        `)
        .eq('user_id', user.id)
        .eq('view_type', 'post')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      setHistory(data || []);
      const viewedPosts = (data || [])
        .map((item: any) => item.posts)
        .filter(Boolean);
      setPosts(viewedPosts);
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    if (!window.confirm('Are you sure you want to clear your entire browsing history?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('browsing_history')
        .delete()
        .eq('user_id', user?.id);

      if (error) throw error;

      setHistory([]);
      setPosts([]);
      toast({
        title: 'History cleared',
        description: 'Your browsing history has been deleted',
      });
    } catch (error: any) {
      console.error('Error clearing history:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="History" showBack />
      <HistoryAdBanner />

      {history.length > 0 && (
        <div className="p-4 border-b border-border">
          <Button
            onClick={clearHistory}
            variant="destructive"
            className="w-full rounded-full"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear All History
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 px-4">
          <History className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="font-semibold mb-2">No browsing history</p>
          <p className="text-sm text-muted-foreground">
            Posts you view will appear here
          </p>
        </div>
      ) : (
        <div>
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onUpdate={fetchHistory} />
          ))}
        </div>
      )}
    </div>
  );
}
