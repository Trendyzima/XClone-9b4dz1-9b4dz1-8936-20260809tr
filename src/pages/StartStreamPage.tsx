import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { Loader2, Video, Users, Radio, Lock, BadgeCheck } from 'lucide-react';
import { toast } from 'sonner';

import { PageAdBanner } from '@/components/features/AdSenseAd';
function StartStreamAdBanner() { return <PageAdBanner />; }

export default function StartStreamPage() {
  useSEO({ noindex: true, title: 'Start Live Stream', url: '/start-stream' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [userProfile, setUserProfile] = useState<any>(null);

  useEffect(() => {
    if (user) {
      supabase
        .from('profiles')
        .select('verified')
        .eq('id', user.id)
        .single()
        .then(({ data }) => setUserProfile(data));
    }
  }, [user]);

  const handleStartStream = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { navigate('/auth'); return; }
    if (!userProfile?.verified) {
      toast.error('Only verified users can go live', {
        description: 'Get your account verified to start live streams.'
      });
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        title: title.trim(),
        description: description.trim(),
        category,
      });
      toast.success('Opening TV Studio…');
      navigate('/tv-studio?' + params.toString());
    } catch (error: any) {
      toast.error(error.message || 'Could not open TV Studio');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Sign in to start streaming</p>
          <Button onClick={() => navigate('/auth')}>Sign In</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Start Live Stream" showBack />
      <StartStreamAdBanner />

      <div className="max-w-2xl mx-auto p-4 md:p-8">
        {/* Verification gate */}
        {userProfile !== null && !userProfile?.verified && (
          <div className="flex items-start gap-3 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl mb-6">
            <Lock className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-orange-700 dark:text-orange-400">Verified accounts only</p>
              <p className="text-sm text-orange-600 dark:text-orange-500 mt-0.5">
                Live streaming is restricted to verified creators. Get verified to unlock this feature.
              </p>
            </div>
          </div>
        )}

        {userProfile?.verified && (
          <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-xl mb-4">
            <BadgeCheck className="w-5 h-5 text-primary" />
            <p className="text-sm font-medium text-primary">Verified creator — you can go live</p>
          </div>
        )}

        <div className="bg-gradient-to-r from-red-500/10 to-pink-500/10 border border-red-500/20 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-3 bg-red-500 rounded-full">
              <Radio className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Go Live</h2>
              <p className="text-sm text-muted-foreground">Stream to your followers in real-time</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleStartStream} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="title">Stream Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's your stream about?"
              required
              maxLength={100}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">{title.length}/100</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell viewers what to expect..."
              rows={4}
              maxLength={500}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">{description.length}/500</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full p-2 border border-border rounded-lg bg-background"
              disabled={loading}
            >
              <option value="general">General</option>
              <option value="gaming">Gaming</option>
              <option value="music">Music</option>
              <option value="sports">Sports</option>
              <option value="education">Education</option>
              <option value="entertainment">Entertainment</option>
              <option value="tech">Technology</option>
              <option value="lifestyle">Lifestyle</option>
              <option value="news">News & Politics</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
              📱 Streaming Tips
            </h4>
            <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
              <li>• Use a stable internet connection</li>
              <li>• Enable notifications so followers know you're live</li>
              <li>• Engage with your viewers in the chat</li>
              <li>• Keep your stream title clear and descriptive</li>
              <li>• Live video is not stored by Testagram</li>
            </ul>
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(-1)}
              disabled={loading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={loading || !title.trim()}
              className="flex-1 bg-gradient-to-r from-red-600 to-pink-600 hover:opacity-90"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Video className="w-4 h-4 mr-2" />
                  Go Live
                </>
              )}
            </Button>
          </div>
        </form>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-muted/30 p-4 rounded-lg">
            <Users className="w-8 h-8 text-primary mb-2" />
            <h3 className="font-semibold mb-1">Unlimited Viewers</h3>
            <p className="text-sm text-muted-foreground">
              Stream to thousands of viewers simultaneously
            </p>
          </div>
          <div className="bg-muted/30 p-4 rounded-lg">
            <Video className="w-8 h-8 text-primary mb-2" />
            <h3 className="font-semibold mb-1">HD Quality</h3>
            <p className="text-sm text-muted-foreground">
              Broadcast in high definition up to 1080p
            </p>
          </div>
          <div className="bg-muted/30 p-4 rounded-lg">
            <Radio className="w-8 h-8 text-primary mb-2" />
            <h3 className="font-semibold mb-1">Ephemeral live</h3>
            <p className="text-sm text-muted-foreground">
              Only the live signal is delivered; recordings stay on your device if you choose to record locally
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
