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

async function optimizeProfileImage(file: File, kind: MediaKind): Promise<File> {
  // Keep animated GIFs untouched. Other images are resized and encoded as WebP in-browser
  // so mobile uploads send dramatically fewer bytes over the network.
  if (file.type === 'image/gif') return file;
  const maxDimension = kind === 'avatar' ? 512 : 1600;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close(); return file; }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', kind === 'avatar' ? 0.84 : 0.86));
  if (!blob) return file;
  // Never make optimization larger than the source.
  return blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp', lastModified: Date.now() }) : file;
}

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
      toast({ title: 'Error', description: 'Cover image must be less than 5MB', variant: 'destructive' });
      return;
    }
    setCoverImage(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const uploadProfileMedia = async (file: File, kind: MediaKind) => {
    if (!user) throw new Error('Not authenticated');
    const optimized = await optimizeProfileImage(file, kind);
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', optimized, optimized.name);
    const { data, error } = await supabase.functions.invoke('profile-media-upload', { body: form });
    if (error) throw new Error(error.message || 'Profile media upload failed');
    if (!data?.ok || !data.delivery_url) throw new Error('Profile media upload was not completed');
    return data.delivery_url as string;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const cleanUsername = username.trim();
    if (!/^[A-Za-z0-9_]{3,32}$/.test(cleanUsername)) {
      toast({ title: 'Invalid username', description: 'Use 3–32 letters, numbers, or underscores.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      let avatarUrl = avatarPreview;
      let coverUrl = coverPreview;
      // Upload both assets concurrently so a cover + avatar save is not needlessly serialized.
      const [uploadedAvatar, uploadedCover] = await Promise.all([
        avatar ? uploadProfileMedia(avatar, 'avatar') : Promise.resolve(avatarUrl),
        coverImage ? uploadProfileMedia(coverImage, 'cover') : Promise.resolve(coverUrl),
      ]);
      avatarUrl = uploadedAvatar;
      coverUrl = uploadedCover;

      const social_links: SocialLinks = {
        twitter: twitterHandle.trim().replace(/^@/, '') || null,
        instagram: instagramHandle.trim().replace(/^@/, '') || null,
        linkedin: linkedinUrl.trim() || null,
      };

      const { data: profileUpdate, error: updateError } = await supabase.rpc('profile_update', {
        p_input: {
          username: cleanUsername,
          bio: bio.trim() || null,
          website: website.trim() || null,
          location: location.trim() || null,
          birth_date: birthDate || null,
          social_links,
          avatar_url: avatarUrl || null,
          cover_url: coverUrl || null,
        },
      });
      if (updateError) throw updateError;
      if (!profileUpdate?.updated) throw new Error('Profile update was not confirmed by the server');

      await supabase.auth.updateUser({ data: { username: cleanUsername } });
      toast({ title: 'Success', description: 'Profile updated successfully' });
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('[profile-editor] update failed:', error);
      toast({ title: 'Error', description: error.message || 'Failed to update profile', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit profile</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <Label>Cover Image</Label>
            <label className="relative cursor-pointer group block mt-2">
              <div className="w-full h-32 rounded-lg bg-muted overflow-hidden">
                {coverPreview ? <img src={coverPreview} alt="Cover" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Upload className="w-8 h-8" /></div>}
              </div>
              <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Camera className="w-8 h-8 text-white" /></div>
              <input type="file" accept="image/*" className="hidden" onChange={handleCoverChange} disabled={loading} />
            </label>
          </div>
          <div className="flex justify-center">
            <label className="relative cursor-pointer group">
              <div className="w-24 h-24 rounded-full bg-muted overflow-hidden border-4 border-background">
                {avatarPreview ? <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-2xl font-bold">{username[0]?.toUpperCase()}</div>}
              </div>
              <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Camera className="w-8 h-8 text-white" /></div>
              <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} disabled={loading} />
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2"><Label htmlFor="username">Username *</Label><Input id="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="your_username" required disabled={loading} /></div>
            <div className="space-y-2"><Label htmlFor="email">Email (read-only)</Label><Input id="email" value={user?.email || ''} disabled className="bg-muted" /></div>
            <div className="space-y-2 md:col-span-2"><Label htmlFor="bio">Bio</Label><Textarea id="bio" value={bio} onChange={e => setBio(e.target.value)} placeholder="Tell us about yourself" rows={3} maxLength={160} disabled={loading} /><p className="text-xs text-muted-foreground text-right">{bio.length}/160</p></div>
            <div className="space-y-2"><Label htmlFor="location">Location</Label><Input id="location" value={location} onChange={e => setLocation(e.target.value)} placeholder="City, Country" disabled={loading} /></div>
            <div className="space-y-2"><Label htmlFor="website">Website</Label><Input id="website" type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://yourwebsite.com" disabled={loading} /></div>
            <div className="space-y-2"><Label htmlFor="birthDate">Birth Date</Label><Input id="birthDate" type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} disabled={loading} /></div>
            <div className="space-y-2"><Label htmlFor="twitter">Twitter / X Handle</Label><Input id="twitter" value={twitterHandle} onChange={e => setTwitterHandle(e.target.value)} placeholder="@yourusername" disabled={loading} /></div>
            <div className="space-y-2"><Label htmlFor="instagram">Instagram Handle</Label><Input id="instagram" value={instagramHandle} onChange={e => setInstagramHandle(e.target.value)} placeholder="@yourusername" disabled={loading} /></div>
            <div className="space-y-2 md:col-span-2"><Label htmlFor="linkedin">LinkedIn URL</Label><Input id="linkedin" type="url" value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/yourusername" disabled={loading} /></div>
          </div>
          <div className="flex space-x-2 pt-4"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading} className="flex-1">Cancel</Button><Button type="submit" disabled={loading} className="flex-1">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}