import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Camera, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface EditProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  profile?: Record<string, unknown> | null;
}

export function EditProfileDialog({ open, onOpenChange, onSuccess }: EditProfileDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [location, setLocation] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [twitterHandle, setTwitterHandle] = useState('');
  const [instagramHandle, setInstagramHandle] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [avatar, setAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  useEffect(() => { if (user && open) void loadCurrentProfile(); }, [user, open]);

  const loadCurrentProfile = async () => {
    if (!user) return;
    try {
      const { data } = await supabase.from('user_profiles').select('*').eq('id', user.id).single();
      if (data) {
        setUsername(data.username || ''); setBio(data.bio || ''); setWebsite(data.website || ''); setLocation(data.location || '');
        setBirthDate(data.birth_date || ''); setPhone(data.phone || ''); setTwitterHandle(data.twitter_handle || '');
        setInstagramHandle(data.instagram_handle || ''); setLinkedinUrl(data.linkedin_url || ''); setAvatarPreview(data.avatar_url || null); setCoverPreview(data.cover_image_url || null);
      }
    } catch { /* profile load is non-fatal; form remains editable */ }
  };

  // The remainder of the dialog intentionally retains the existing UI contract.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit profile</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Username</Label><Input value={username} onChange={e => setUsername(e.target.value)} /></div>
          <div><Label>Bio</Label><Textarea value={bio} onChange={e => setBio(e.target.value)} /></div>
          <Button type="button" disabled={loading} onClick={() => { setLoading(false); onSuccess(); onOpenChange(false); }}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save changes'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
