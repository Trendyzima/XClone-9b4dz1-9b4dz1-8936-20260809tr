import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Search } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { useSEO } from '@/hooks/useSEO';

type TopicPost = {
  id?: string;
  post_id?: string;
  content?: string;
  text?: string;
  created_at?: string;
  likes_count?: number;
  replies_count?: number;
  author?: { username?: string; display_name?: string };
};

export default function TrendingTopicFeedPage() {
  const { topic = '' } = useParams<{ topic: string }>();
  const normalizedTopic = decodeURIComponent(topic).replace(/^#/, '').trim();
  const [posts, setPosts] = useState<TopicPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useSEO({ title: normalizedTopic ? `#${normalizedTopic} | Testagram` : 'Trending topic | Testagram', description: 'Posts discussing this trending topic on Testagram.' });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    backendCapabilities.call<{ posts?: TopicPost[] }>('testagram.search.unified', {
      q: normalizedTopic,
      kind: 'posts',
      limit: 30,
      offset: 0,
      sort: 'latest',
    }).then((result) => {
      if (active) setPosts(Array.isArray(result?.posts) ? result.posts : []);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'This topic feed is temporarily unavailable.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [normalizedTopic]);

  return <div className="min-h-screen bg-background">
    <TopBar title={normalizedTopic ? `#${normalizedTopic}` : 'Trending topic'} />
    <main className="mx-auto w-full max-w-2xl divide-y divide-border">
      <header className="flex items-center gap-3 px-4 py-5">
        <div className="rounded-full bg-muted p-3"><Search className="h-5 w-5" /></div>
        <div><p className="text-xs text-muted-foreground">Trending topic</p><h1 className="text-xl font-bold">#{normalizedTopic}</h1></div>
      </header>
      {loading ? <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading topic posts…</div>
        : error ? <p role="alert" className="p-6 text-sm text-destructive">{error}</p>
        : posts.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">No public posts found for this topic yet.</p>
        : posts.map((post, index) => <article key={post.id ?? post.post_id ?? index} className="space-y-2 px-4 py-4">
          <p className="text-sm font-semibold">{post.author?.display_name || post.author?.username || 'Testagram user'}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{post.content || post.text || ''}</p>
          <p className="text-xs text-muted-foreground">{post.created_at ? new Date(post.created_at).toLocaleString() : ''} · {post.likes_count ?? 0} likes · {post.replies_count ?? 0} replies</p>
        </article>)}
    </main>
  </div>;
}
