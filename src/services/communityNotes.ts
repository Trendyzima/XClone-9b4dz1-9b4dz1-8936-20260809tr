import { supabase } from '@/lib/supabase';

export type NotePerspective =
  | 'general'
  | 'technical'
  | 'local'
  | 'lived_experience'
  | 'subject_matter'
  | 'other';

export interface CommunityNote {
  id: string;
  post_id: string;
  author_id: string;
  text: string;
  status: 'needs_ratings' | 'published' | 'rejected' | 'hidden';
  helpful_score: number;
  rating_count: number;
  distinct_rater_count: number;
  perspective_count: number;
  published_at: string | null;
  created_at: string;
}

export async function getCommunityNotes(postId: string): Promise<CommunityNote[]> {
  const { data, error } = await supabase.rpc('get_post_community_notes', { p_post_id: postId });
  if (error) throw error;
  return (data ?? []) as CommunityNote[];
}

export async function createCommunityNote(
  postId: string,
  authorId: string,
  text: string,
): Promise<CommunityNote> {
  const cleaned = text.trim();
  if (cleaned.length < 20 || cleaned.length > 1000) {
    throw new Error('A community note must be between 20 and 1000 characters.');
  }

  const { data, error } = await supabase
    .from('community_notes')
    .insert({ post_id: postId, author_id: authorId, text: cleaned })
    .select('*')
    .single();

  if (error) throw error;
  return data as CommunityNote;
}

export async function rateCommunityNote(
  noteId: string,
  raterId: string,
  helpful: boolean,
  perspective: NotePerspective = 'general',
): Promise<void> {
  const { error } = await supabase
    .from('community_note_ratings')
    .upsert(
      {
        note_id: noteId,
        rater_id: raterId,
        helpful,
        perspective,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'note_id,rater_id' },
    );

  if (error) throw error;
}

export async function enrollCommunityNotesContributor(
  userId: string,
  perspective: NotePerspective = 'general',
): Promise<void> {
  const { error } = await supabase
    .from('community_note_contributors')
    .upsert({ user_id: userId, enrolled: true, perspective, updated_at: new Date().toISOString() });

  if (error) throw error;
}
