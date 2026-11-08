import { BackendClientError } from '@/services/backendClient';

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

/**
 * Matrix federation is not an XClone-owned implementation. The frontend must
 * call a versioned Backend/Federation contract once that contract is deployed.
 * Never fall back to Supabase Edge Functions or perform federation work here.
 */
function unavailable(operation: string): never {
  throw new BackendClientError(
    `Matrix federation operation "${operation}" is unavailable until its Backend/Federation API contract is deployed.`,
    { code: 'FEDERATION_API_NOT_DEPLOYED', status: 501 },
  );
}

export async function linkMatrixIdentity(_matrixUserId: string, _homeserver: string): Promise<MatrixIdentity> {
  return unavailable('link_identity');
}

export async function createMatrixRoom(_conversationId: string): Promise<MatrixRoom> {
  return unavailable('create_room');
}

export async function sendMatrixEvent(
  _conversationId: string,
  _eventType: string,
  _content: Record<string, unknown>,
): Promise<{ room_id: string; event: { event_id?: string } }> {
  return unavailable('send_event');
}

export const matrixFederationService = { linkMatrixIdentity, createMatrixRoom, sendMatrixEvent };
export default matrixFederationService;
