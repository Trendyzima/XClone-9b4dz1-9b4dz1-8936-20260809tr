import { Navigate, useParams } from 'react-router-dom';

/**
 * Keep legacy trending-topic URLs working while routing to the canonical
 * hashtag page. Topic slugs are normalized by the hashtag page itself.
 */
export default function TrendingTopicFeedPage() {
  const { topic } = useParams();
  if (!topic?.trim()) return <Navigate to="/explore" replace />;
  return <Navigate to={`/hashtag/${encodeURIComponent(topic.replace(/^#/, ''))}`} replace />;
}
