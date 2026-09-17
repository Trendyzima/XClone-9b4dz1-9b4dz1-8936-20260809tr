import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { pingGoogleSitemap } from '@/lib/pingGoogle';
import { Radio, Loader2 } from 'lucide-react';

interface StartSpaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function StartSpaceDialog({ open, onOpenChange, onSuccess }: StartSpaceDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({ title: '', description: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !formData.title.trim()) return;

    setLoading(true);
    try {
      const { data: space, error: createError } = await supabase.rpc('create_audio_space', {
        p_title: formData.title.trim(),
        p_description: formData.description.trim(),
        p_topic: '',
        p_visibility: 'public',
        p_category: 'general',
        p_language: 'und',
        p_scheduled_for: null,
        p_max_audience: 1000,
        p_recording_enabled: false,
        p_listener_requests_enabled: true,
      });
      if (createError || !space?.id) throw createError ?? new Error('Failed to create Audio Space');

      const { error: startError } = await supabase.rpc('start_audio_space', { p_space_id: space.id });
      if (startError) throw startError;

      toast({ title: 'Space started!', description: 'Your audio space is now live.' });
      pingGoogleSitemap();
      setFormData({ title: '', description: '' });
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      console.error('Error starting space:', error);
      toast({ title: 'Error', description: error.message || 'Failed to start space', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-primary" />
            <span>Start a Space</span>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-sm font-semibold mb-2 block">Title *</Label>
            <Input placeholder="What's your Space about?" value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })} maxLength={100} required />
          </div>
          <div>
            <Label className="text-sm font-semibold mb-2 block">Description</Label>
            <Textarea placeholder="Add more details about your Space..." value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })} maxLength={500} rows={3} />
          </div>
          <div className="bg-muted/50 p-4 rounded-lg text-sm space-y-2">
            <p className="font-semibold">🎙️ Space Guidelines:</p>
            <ul className="text-muted-foreground space-y-1 text-xs">
              <li>• Be respectful and inclusive to all participants</li>
              <li>• Keep conversations relevant to the topic</li>
              <li>• The host controls speakers and moderation</li>
              <li>• Spaces can be ended at any time by the host</li>
            </ul>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading || !formData.title.trim()}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Starting...</> : <><Radio className="w-4 h-4 mr-2" />Start Space</>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
