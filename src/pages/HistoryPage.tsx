import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { PostCard } from '@/components/features/PostCard';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
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
  const [threads, setThreads] = useState<any[]>([]);
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
      const result = await backendCapabilities.listBrowsingHistory();
      const entries = (result.items || []).filter((item) => ['post', 'video', 'thread'].includes(item.entity_type));
      setHistory(entries);
      const [postRows, threadRows] = await Promise.all([
        Promise.all(entries.filter(item => item.entity_type === 'post' || item.entity_type === 'video').map(item =>
          backendCapabilities.getPost(item.entity_id).catch(() => null),
        )),
        Promise.all(entries.filter(item => item.entity_type === 'thread').map(item =>
          backendCapabilities.getThread(item.entity_id).catch(() => null),
        )),
      ]);
      setPosts(postRows.filter(Boolean).map((item: any) => item.post ?? item) as Post[]);
      setThreads(threadRows.filter(Boolean));
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
      await backendCapabilities.clearBrowsingHistory();

      setHistory([]);
      setPosts([]);
      setThreads([]);
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
      ) : posts.length === 0 && threads.length === 0 ? (
        <div className="text-center py-12 px-4">
          <History className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="font-semibold mb-2">No browsing history</p>
          <p className="text-sm text-muted-foreground">
            Posts you view will appear here
          </p>
        </div>
      ) : (
        <div>
          {threads.map((thread) => (
            <button key={thread.id} onClick={() => navigate('/thread/' + thread.id)} className="w-full border-b border-border px-4 py-4 text-left hover:bg-muted/20">
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{thread.body || 'Thread with attachments'}</p>
              <span className="mt-2 block text-xs text-muted-foreground">Thread · {new Date(thread.created_at).toLocaleString()}</span>
            </button>
          ))}
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onUpdate={fetchHistory} />
          ))}
        </div>
      )}
    </div>
  );
}
