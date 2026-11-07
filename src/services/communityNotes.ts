import { backendCapabilities } from '@/services/testagramCapabilityClient';

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
  const result = await backendCapabilities.call<{ items: CommunityNote[] }>('testagram.community_notes.list', { post_id: postId });
  return result.items;
}

export async function createCommunityNote(postId: string, authorId: string, text: string): Promise<CommunityNote> {
  const cleaned = text.trim();
  if (cleaned.length < 20 || cleaned.length > 1000) throw new Error('A community note must be between 20 and 1000 characters.');
  return backendCapabilities.call<CommunityNote>('testagram.community_notes.create', { post_id: postId, author_id: authorId, text: cleaned });
}

export async function rateCommunityNote(noteId: string, raterId: string, helpful: boolean, perspective: NotePerspective = 'general'): Promise<void> {
  await backendCapabilities.call('testagram.community_notes.rate', { note_id: noteId, rater_id: raterId, helpful, perspective });
}

export async function enrollCommunityNotesContributor(userId: string, perspective: NotePerspective = 'general'): Promise<void> {
  await backendCapabilities.call('testagram.community_notes.contributor.enroll', { user_id: userId, perspective });
}
