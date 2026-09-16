import { supabase } from '@/lib/supabase';

export interface MatrixIdentity {
  user_id: string;
  matrix_user_id: string;
  homeserver: string;
  created_at: string;
  updated_at: string;
}

export interface MatrixRoom {
  conversation_id: string;
  room_id: string;
  homeserver: string;
  status: 'pending' | 'active' | 'disabled';
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('matrix-bridge', { body });
  if (error) throw new Error(`Matrix bridge request failed: ${error.message}`);
  if (!data?.ok) throw new Error(data?.error ?? 'Matrix bridge request failed');
  return data as T;
}

export async function linkMatrixIdentity(matrixUserId: string, homeserver: string): Promise<MatrixIdentity> {
  const result = await invoke<{ identity: MatrixIdentity }>({ operation: 'link_identity', matrix_user_id: matrixUserId, homeserver });
  return result.identity;
}

export async function createMatrixRoom(conversationId: string): Promise<MatrixRoom> {
  const result = await invoke<{ room: MatrixRoom }>({ operation: 'create_room', conversation_id: conversationId });
  return result.room;
}

export async function sendMatrixEvent(conversationId: string, eventType: string, content: Record<string, unknown>) {
  return invoke<{ room_id: string; event: { event_id?: string } }>({ operation: 'send_event', conversation_id: conversationId, event_type: eventType, content });
}

export const matrixFederationService = { linkMatrixIdentity, createMatrixRoom, sendMatrixEvent };
export default matrixFederationService;
