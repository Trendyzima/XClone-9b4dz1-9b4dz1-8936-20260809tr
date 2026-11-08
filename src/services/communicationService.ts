import { backendCapabilities, type CapabilityPage } from '@/services/testagramCapabilityClient';
import { communicationCrypto } from '@/services/communicationCrypto';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';

export type CommunicationConversation = { id: string; created_at: string; updated_at: string; latest_message?: Record<string, unknown> | null; [key: string]: unknown };
export type CommunicationMessage = { id: string; conversation_id: string; sender_id: string; body: string; media_url?: string | null; media_type?: string | null; created_at: string; edited_at?: string | null; deleted_at?: string | null; reply_to_message_id?: string | null; shared_post_id?: string | null; client_message_id?: string | null; delivered_at?: string | null; read_at?: string | null; view_once?: boolean; expires_at?: string | null; forwarded_from_id?: string | null; e2ee_enabled?: boolean; e2ee_version?: string | null; e2ee_epoch?: number | null; ciphertext?: string | null; nonce?: string | null; aad?: string | null; sender?: Record<string, unknown> | null };
export type MessageAttachment = { id: string; message_id: string; owner_id: string; media_url: string; media_type: string; mime_type?: string | null; byte_size: number; duration_ms?: number | null; width?: number | null; height?: number | null; created_at: string };
export type TypingState = { user_id: string; typing: boolean; at: string };
export type PresenceState = { user_id: string; status: 'online' | 'away' | 'offline'; at: string };
export type CallSession = { created_at?: string; call_id: string; provider: 'testagram-native' | 'testagram-p2p'; room_name: string; conversation_id?: string; created_by?: string; status?: 'ringing' | 'active' | 'ended' | 'failed'; kind?: 'voice' | 'video' | 'screen'; e2ee_enabled?: boolean; e2ee_epoch?: number | null; caller_phone?: string | null; caller_phone_verified?: boolean; caller_display_name?: string | null; caller_username?: string | null; caller_avatar_url?: string | null };
export type CallSessionChange = { operation: 'INSERT' | 'UPDATE' | 'DELETE'; session: CallSession; previous?: Partial<CallSession> | null };
export type ConversationSettings = { conversation_id: string; user_id: string; archived_at?: string | null; pinned_at?: string | null; muted_until?: string | null; disappearing_seconds?: number | null };
export type CommunicationStatus = { id: string; user_id: string; media_url?: string | null; media_type: 'text' | 'image' | 'video'; caption?: string | null; background?: string | null; created_at: string; expires_at: string };

const conversationTopic = (conversationId: string) => `conversation:${conversationId}`;
type ConversationHandlers = { onMessage?: (message: CommunicationMessage) => void; onMessageChanged?: (message: CommunicationMessage) => void; onMessageDeleted?: (message: CommunicationMessage) => void; onTyping?: (state: TypingState) => void; onPresence?: (state: PresenceState) => void; onCall?: (change: CallSessionChange) => void };
type CallHandlers = { onCall?: (change: CallSessionChange) => void };
const normalizeCall = (row: Record<string, unknown>): CallSession => { const metadata = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>; return { ...(row as CallSession), call_id: String(row.id ?? row.call_id), provider: 'testagram-native', e2ee_enabled: Boolean(metadata.e2ee_enabled ?? row.e2ee_enabled), e2ee_epoch: metadata.e2ee_epoch == null && row.e2ee_epoch == null ? null : Number(metadata.e2ee_epoch ?? row.e2ee_epoch), caller_phone: typeof metadata.caller_phone === 'string' ? metadata.caller_phone : null, caller_phone_verified: Boolean(metadata.caller_phone_verified), caller_display_name: typeof metadata.caller_display_name === 'string' ? metadata.caller_display_name : null, caller_username: typeof metadata.caller_username === 'string' ? metadata.caller_username : null, caller_avatar_url: typeof metadata.caller_avatar_url === 'string' ? metadata.caller_avatar_url : null, }; };
const encryptInput = async (conversationId: string, body: string) => { const encrypted = await communicationCrypto.encryptMessage(conversationId, body); return { ...encrypted, aad: `${conversationId}:${encrypted.epoch}`, e2ee_version: 'v1' }; };

export const communicationService = {
  listConversations(limit = 50) { return backendCapabilities.call<{ items: CommunicationConversation[] }>('testagram.conversations.list', { limit }); },
  createConversation(memberIds: string[]) { return backendCapabilities.call<{ conversation_id: string }>('testagram.conversations.create', { member_ids: memberIds }); },
  async listMessages(conversationId: string, limit = 50, cursor?: string) { const result = await backendCapabilities.call<CapabilityPage<CommunicationMessage>>('testagram.messages.list', { conversation_id: conversationId, limit, ...(cursor ? { cursor } : {}) }); return { ...result, items: await this.decryptMessages(result.items ?? []) }; },
  async decryptMessage(message: CommunicationMessage) { const attachment = Array.isArray((message as any).attachment_metadata) ? (message as any).attachment_metadata[0] : null; const normalized = { ...message, e2ee_enabled: message.e2ee_enabled ?? Boolean(message.ciphertext && message.nonce), e2ee_epoch: message.e2ee_epoch ?? (message as any).key_epoch ?? null, reply_to_message_id: message.reply_to_message_id ?? (message as any).reply_to_id ?? null, media_url: message.media_url ?? attachment?.media_url ?? null, media_type: message.media_type ?? attachment?.media_type ?? null }; if (!normalized.e2ee_enabled || !normalized.ciphertext || !normalized.nonce || normalized.e2ee_epoch == null) return normalized; const body = await communicationCrypto.decryptMessage(normalized.conversation_id, normalized.e2ee_epoch, normalized.ciphertext, normalized.nonce, normalized.aad ?? undefined); return { ...normalized, body }; },
  async decryptMessages(messages: CommunicationMessage[]) { return Promise.all(messages.map(message => this.decryptMessage(message))); },
  async sendMessage(input: { conversationId: string; body: string; clientMessageId?: string; replyToMessageId?: string; sharedPostId?: string }) {
    const encrypted = await encryptInput(input.conversationId, input.body);
    const result = await backendCapabilities.call<{ message_id: string; encrypted: boolean }>('testagram.messages.send_encrypted', { conversation_id: input.conversationId, e2ee_epoch: encrypted.epoch, ciphertext: encrypted.ciphertext, nonce: encrypted.nonce, ...(input.clientMessageId ? { client_message_id: input.clientMessageId } : {}), ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}), ...(input.sharedPostId ? { shared_post_id: input.sharedPostId } : {}) });
    trackTestagramEvent(TestagramEvent.MESSAGE_SENT, { conversation_id: input.conversationId, message_id: result.message_id, has_reply: Boolean(input.replyToMessageId), has_shared_post: Boolean(input.sharedPostId), encrypted: true }); return result;
  },
  async editMessage(messageId: string, body: string, conversationId: string) { const encrypted = await encryptInput(conversationId, body); const result = await backendCapabilities.call<{ message_id: string; edited: boolean }>('testagram.messages.edit_encrypted', { message_id: messageId, e2ee_epoch: encrypted.epoch, ciphertext: encrypted.ciphertext, nonce: encrypted.nonce }); trackTestagramEvent(TestagramEvent.MESSAGE_EDITED, { message_id: result.message_id, encrypted: true }); return result; },
  async deleteMessage(messageId: string) { const result = await backendCapabilities.call<{ message_id: string; deleted: boolean }>('testagram.messages.delete', { message_id: messageId }); trackTestagramEvent(TestagramEvent.MESSAGE_DELETED, { message_id: result.message_id }); return result; },
  attachMessage(input: { messageId: string; mediaUrl: string; mediaType: string; mimeType?: string; byteSize: number; durationMs?: number; width?: number; height?: number }) { return backendCapabilities.call<{ attachment: MessageAttachment }>('testagram.messages.attach', { message_id: input.messageId, attachment_metadata: { media_url: input.mediaUrl, media_type: input.mediaType, ...(input.mimeType ? { mime_type: input.mimeType } : {}), byte_size: input.byteSize, ...(input.durationMs !== undefined ? { duration_ms: input.durationMs } : {}), ...(input.width !== undefined ? { width: input.width } : {}), ...(input.height !== undefined ? { height: input.height } : {}) } }); },
  markMessageRead(messageId: string) { return backendCapabilities.call<{ message_id: string; read: boolean }>('testagram.messages.mark_read', { message_id: messageId }); },
  async forwardMessage(message: CommunicationMessage, conversationId: string) { const body = message.body?.trim() || (message.media_url ? '[Attachment]' : ''); if (!body) throw new Error('Nothing to forward'); const result = await this.sendMessage({ conversationId, body }); if (message.media_url) await this.attachMessage({ messageId: result.message_id, mediaUrl: message.media_url, mediaType: message.media_type || 'file', byteSize: 0 }); return { ...result, forwarded: true, source_message_id: message.id }; },
  async reactToMessage(messageId: string, reaction: string, remove = false) { const result = await backendCapabilities.call<{ message_id: string; reaction: string; removed: boolean }>('testagram.messages.react', { message_id: messageId, reaction, remove }); trackTestagramEvent(TestagramEvent.MESSAGE_REACTED, { message_id: messageId, reaction, removed: result.removed }); return result; },
  starMessage(messageId: string) { return backendCapabilities.call('testagram.messages.star', { message_id: messageId }); },
  unstarMessage(messageId: string) { return backendCapabilities.call('testagram.messages.unstar', { message_id: messageId }); },
  listStarredMessages(limit = 100) { return backendCapabilities.call('testagram.messages.starred.list', { limit }); },
  getConversationSettings(conversationId: string) { return backendCapabilities.call<ConversationSettings | null>('testagram.conversations.settings.read', { conversation_id: conversationId }); },
  setConversationSettings(conversationId: string, patch: Partial<Omit<ConversationSettings, 'conversation_id' | 'user_id'>>) { return backendCapabilities.call<ConversationSettings>('testagram.conversations.settings.update', { conversation_id: conversationId, ...patch }); },
  listStatuses(limit = 100) { return backendCapabilities.call<CommunicationStatus[]>('testagram.statuses.list', { limit }); },
  createTextStatus(text: string, background = 'default') { return backendCapabilities.call<CommunicationStatus>('testagram.statuses.create', { media_type: 'text', caption: text, background }); },
  createMediaStatus(mediaUrl: string, mediaType: 'image' | 'video', caption = '') { return backendCapabilities.call<CommunicationStatus>('testagram.statuses.create', { media_type: mediaType, media_url: mediaUrl, caption }); },
  markStatusViewed(statusId: string) { return backendCapabilities.call('testagram.statuses.view', { status_id: statusId }); },
  getCall(callId: string) { return backendCapabilities.call<{ call: CallSession }>('testagram.calls.get', { call_id: callId }); },
  async createCall(conversationId: string, kind: 'voice' | 'video' | 'screen' = 'video') { const result = await backendCapabilities.call<CallSession>('testagram.calls.create', { conversation_id: conversationId, kind, e2ee_enabled: true }); trackTestagramEvent('testagram_call_started' as never, { conversation_id: conversationId, call_id: result.call_id, kind, encrypted: true, e2ee_mode: 'dtls-srtp-p2p', transport: 'testagram-p2p' }); return result; },
  async joinCall(callId: string) { const result = await backendCapabilities.call<{ call_id: string; joined: boolean; conversation_id?: string }>('testagram.calls.join', { call_id: callId }); trackTestagramEvent('testagram_call_joined' as never, { call_id: result.call_id }); return result; },
  async endCall(callId: string) { const result = await backendCapabilities.call<{ call_id: string; ended: boolean }>('testagram.calls.end', { call_id: callId }); trackTestagramEvent('testagram_call_ended' as never, { call_id: result.call_id }); return result; },
  subscribeToConversation(conversationId: string, handlers: ConversationHandlers = {}) {
    let stopped = false;
    let messageCursor: string | undefined;
    let callCursor: string | undefined;
    const poll = async () => {
      if (stopped) return;
      try {
        const page = await this.listMessages(conversationId, 50, messageCursor);
        for (const message of [...(page.items ?? [])].reverse()) handlers.onMessage?.(message);
        messageCursor = page.next_cursor ?? messageCursor;
      } catch (error) { console.warn('[communication] message polling failed', error); }
      try {
        const calls = await backendCapabilities.call<CapabilityPage<CallSession>>('testagram.calls.list', { conversation_id: conversationId, limit: 20, ...(callCursor ? { cursor: callCursor } : {}) });
        for (const call of calls.items ?? []) handlers.onCall?.({ operation: 'UPDATE', session: normalizeCall(call as unknown as Record<string, unknown>) });
        callCursor = calls.next_cursor ?? callCursor;
      } catch (error) { console.warn('[communication] call polling failed', error); }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 4000);
    return () => { stopped = true; window.clearInterval(timer); };
  },
  subscribeToCallSessions(conversationId: string, handlersOrCallback: CallHandlers | ((change: CallSessionChange) => void) = {}) {
    const handlers: CallHandlers = typeof handlersOrCallback === 'function' ? { onCall: handlersOrCallback } : handlersOrCallback;
    return this.subscribeToConversation(conversationId, { onCall: handlers.onCall });
  },
  setTyping(conversationId: string, typing: boolean) { return backendCapabilities.call('testagram.conversations.typing', { conversation_id: conversationId, typing }); },
  setPresence(conversationId: string, status: PresenceState['status']) { return backendCapabilities.call('testagram.conversations.presence', { conversation_id: conversationId, status }); },
};
