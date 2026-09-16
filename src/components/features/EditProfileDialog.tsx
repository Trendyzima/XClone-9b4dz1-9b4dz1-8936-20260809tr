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

type SocialLinks = { twitter?: string | null; instagram?: string | null; linkedin?: string | null };
type ProfileRow = Record<string, unknown> & {
  social_links?: unknown;
  username?: unknown;
  bio?: unknown;
  website?: unknown;
  location?: unknown;
  birth_date?: unknown;
  avatar_url?: unknown;
  cover_url?: unknown;
};
type MediaKind = 'avatar' | 'cover';

const textValue = (value: unknown): string => (typeof value === 'string' ? value : '');
const nullableTextValue = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export function EditProfileDialog({ open, onOpenChange, onSuccess, profile: profileProp }: EditProfileDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [location, setLocation] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [twitterHandle, setTwitterHandle] = useState('');
  const [instagramHandle, setInstagramHandle] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [avatar, setAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !open) return;
    const loadCurrentProfile = async () => {
      try {
        const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        if (error) throw error;
        const row = (data ?? profileProp ?? {}) as ProfileRow;
        const links = (row.social_links ?? {}) as SocialLinks;
        setUsername(textValue(row.username));
        setBio(textValue(row.bio));
        setWebsite(textValue(row.website));
        setLocation(textValue(row.location));
        setBirthDate(textValue(row.birth_date));
        setTwitterHandle(textValue(links.twitter));
        setInstagramHandle(textValue(links.instagram));
        setLinkedinUrl(textValue(links.linkedin));
        setAvatarPreview(nullableTextValue(row.avatar_url));
        setCoverPreview(nullableTextValue(row.cover_url));
      } catch (error) {
        console.debug('[profile-editor] load unavailable; using current profile state', error);
        const row = (profileProp ?? {}) as ProfileRow;
        const links = (row.social_links ?? {}) as SocialLinks;
        setUsername(textValue(row.username));
        setBio(textValue(row.bio));
        setWebsite(textValue(row.website));
        setLocation(textValue(row.location));
        setBirthDate(textValue(row.birth_date));
        setTwitterHandle(textValue(links.twitter));
        setInstagramHandle(textValue(links.instagram));
        setLinkedinUrl(textValue(links.linkedin));
        setAvatarPreview(nullableTextValue(row.avatar_url));
        setCoverPreview(nullableTextValue(row.cover_url));
      }
    };
    void loadCurrentProfile();
  }, [user, open, profileProp]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'Error', description: 'Image must be less than 2MB', variant: 'destructive' });
      return;
    }
    setAvatar(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Error', description: 'Image must be less than 5MB', variant: 'destructive' });
      return;
    }
    setCoverImage(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const uploadMedia = async (file: File, kind: MediaKind): Promise<string | null> => {
    if (!user) return null;
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${user.id}/${kind}-${Date.now()}.${extension}`;
    const { error } = await supabase.storage.from('profiles').upload(path, file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('profiles').getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSave = async () => {
    if (!user) return;
    setLoading(true);
    try {
      let avatarUrl = avatarPreview;
      let coverUrl = coverPreview;
      if (avatar) avatarUrl = await uploadMedia(avatar, 'avatar');
      if (coverImage) coverUrl = await uploadMedia(coverImage, 'cover');

      const social_links: SocialLinks = {
        twitter: twitterHandle || null,
        instagram: instagramHandle || null,
        linkedin: linkedinUrl || null,
      };

      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        username,
        bio,
        website,
        location,
        birth_date: birthDate || null,
        social_links,
        avatar_url: avatarUrl,
        cover_url: coverUrl,
      });
      if (error) throw error;
      toast({ title: 'Profile updated' });
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('[profile-editor] save failed', error);
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Could not update profile', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor="username">Username</Label><Input id="username" value={username} onChange={e => setUsername(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="bio">Bio</Label><Textarea id="bio" value={bio} onChange={e => setBio(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="website">Website</Label><Input id="website" value={website} onChange={e => setWebsite(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="location">Location</Label><Input id="location" value={location} onChange={e => setLocation(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="birthDate">Birth date</Label><Input id="birthDate" type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} /></div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="twitter">Twitter</Label><Input id="twitter" value={twitterHandle} onChange={e => setTwitterHandle(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="instagram">Instagram</Label><Input id="instagram" value={instagramHandle} onChange={e => setInstagramHandle(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="linkedin">LinkedIn</Label><Input id="linkedin" value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} /></div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Avatar</Label>
              <label className="flex items-center gap-2 cursor-pointer rounded-md border p-3"><Camera className="h-4 w-4" /><span className="text-sm">Choose image</span><input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} /></label>
              {avatarPreview && <img src={avatarPreview} alt="Avatar preview" className="h-20 w-20 rounded-full object-cover" />}
            </div>
            <div className="space-y-2">
              <Label>Cover</Label>
              <label className="flex items-center gap-2 cursor-pointer rounded-md border p-3"><Upload className="h-4 w-4" /><span className="text-sm">Choose image</span><input type="file" accept="image/*" className="hidden" onChange={handleCoverChange} /></label>
              {coverPreview && <img src={coverPreview} alt="Cover preview" className="h-20 w-full rounded-md object-cover" />}
            </div>
          </div>

          <Button onClick={handleSave} disabled={loading} className="w-full">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
