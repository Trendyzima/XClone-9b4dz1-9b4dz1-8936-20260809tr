import { supabase } from '@/lib/supabase';
import { backendCapabilities, type CapabilityPage } from '@/services/testagramCapabilityClient';

export type CommunicationConversation = { id: string; created_at: string; updated_at: string; latest_message?: Record<string, unknown> | null; [key: string]: unknown };
export type CommunicationMessage = { id: string; conversation_id: string; sender_id: string; body: string; media_url?: string | null; media_type?: string | null; created_at: string; edited_at?: string | null; deleted_at?: string | null; reply_to_message_id?: string | null; shared_post_id?: string | null; client_message_id?: string | null; delivered_at?: string | null; read_at?: string | null; sender?: Record<string, unknown> | null };
export type MessageAttachment = { id: string; message_id: string; owner_id: string; media_url: string; media_type: string; mime_type?: string | null; byte_size: number; duration_ms?: number | null; width?: number | null; height?: number | null; created_at: string };
export type TypingState = { user_id: string; typing: boolean; at: string };
export type PresenceState = { user_id: string; status: 'online' | 'away' | 'offline'; at: string };
export type CallSession = { call_id: string; provider: 'livekit'; room_name: string };
// Must stay identical to the topic parsed by the realtime.messages RLS policy.
const conversationTopic = (conversationId: string) => `conversation:${conversationId}`;

type ConversationHandlers = {
  onMessage?: (message: CommunicationMessage) => void;
  onMessageChanged?: (message: CommunicationMessage) => void;
  onMessageDeleted?: (message: CommunicationMessage) => void;
  onTyping?: (state: TypingState) => void;
  onPresence?: (state: PresenceState) => void;
};

export const communicationService = {
  listConversations(limit = 50) { return backendCapabilities.call<{ items: CommunicationConversation[] }>('testagram.conversations.list', { limit }); },
  createConversation(memberIds: string[]) { return backendCapabilities.call<{ conversation_id: string }>('testagram.conversations.create', { member_ids: memberIds }); },
  listMessages(conversationId: string, limit = 50, cursor?: string) { return backendCapabilities.call<CapabilityPage<CommunicationMessage>>('testagram.messages.list', { conversation_id: conversationId, limit, ...(cursor ? { cursor } : {}) }); },
  sendMessage(input: { conversationId: string; body: string; clientMessageId?: string; replyToMessageId?: string; sharedPostId?: string }) { return backendCapabilities.call<{ message_id: string }>('testagram.messages.send', { conversation_id: input.conversationId, body: input.body, ...(input.clientMessageId ? { client_message_id: input.clientMessageId } : {}), ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}), ...(input.sharedPostId ? { shared_post_id: input.sharedPostId } : {}) }); },
  editMessage(messageId: string, body: string) { return backendCapabilities.call<{ message_id: string; edited: boolean }>('testagram.messages.edit', { message_id: messageId, body }); },
  deleteMessage(messageId: string) { return backendCapabilities.call<{ message_id: string; deleted: boolean }>('testagram.messages.delete', { message_id: messageId }); },
  attachMessage(input: { messageId: string; mediaUrl: string; mediaType: string; mimeType?: string; byteSize: number; durationMs?: number; width?: number; height?: number }) { return backendCapabilities.call<{ attachment: MessageAttachment }>('testagram.messages.attach', { message_id: input.messageId, media_url: input.mediaUrl, media_type: input.mediaType, ...(input.mimeType ? { mime_type: input.mimeType } : {}), byte_size: input.byteSize, ...(input.durationMs !== undefined ? { duration_ms: input.durationMs } : {}), ...(input.width !== undefined ? { width: input.width } : {}), ...(input.height !== undefined ? { height: input.height } : {}) }); },
  markMessageRead(messageId: string) { return backendCapabilities.call<{ message_id: string; read: boolean }>('testagram.messages.mark_read', { message_id: messageId }); },
  reactToMessage(messageId: string, reaction: string, remove = false) { return backendCapabilities.call<{ message_id: string; reaction: string; removed: boolean }>('testagram.messages.react', { message_id: messageId, reaction, remove }); },
  createCall(conversationId: string, kind: 'voice' | 'video' | 'screen' = 'video') { return backendCapabilities.call<CallSession>('testagram.calls.create', { conversation_id: conversationId, kind }); },
  joinCall(callId: string) { return backendCapabilities.call<{ call_id: string; joined: boolean }>('testagram.calls.join', { call_id: callId }); },
  endCall(callId: string) { return backendCapabilities.call<{ call_id: string; ended: boolean }>('testagram.calls.end', { call_id: callId }); },
  async getLiveKitToken(callId: string) {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error('Authentication required');
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/livekit-token`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ call_id: callId }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message ?? 'Unable to obtain call token');
    return payload.data as { token: string; url: string; room_name: string; call_id: string; kind: string };
  },
  subscribeToConversation(conversationId: string, handlersOrCallback: ConversationHandlers | ((message: CommunicationMessage) => void) = {}) {
    const handlers: ConversationHandlers = typeof handlersOrCallback === 'function' ? { onMessage: handlersOrCallback } : handlersOrCallback;
    const channel = supabase
      .channel(conversationTopic(conversationId), { config: { private: true, broadcast: { self: false } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, payload => handlers.onMessage?.(payload.new as CommunicationMessage))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, payload => {
        const message = payload.new as CommunicationMessage;
        if (message.deleted_at) handlers.onMessageDeleted?.(message);
        else handlers.onMessageChanged?.(message);
      })
      .on('broadcast', { event: 'typing' }, payload => {
        const value = payload.payload as Partial<TypingState>;
        if (value.user_id && typeof value.typing === 'boolean') handlers.onTyping?.({ user_id: value.user_id, typing: value.typing, at: value.at ?? new Date().toISOString() });
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<TypingState & { status?: PresenceState['status']; at?: string }>();
        Object.entries(state).forEach(([key, values]) => {
          const value = values[0];
          if (value?.status) handlers.onPresence?.({ user_id: key, status: value.status, at: value.at ?? new Date().toISOString() });
        });
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        const value = newPresences[0] as Partial<PresenceState> | undefined;
        if (value?.status) handlers.onPresence?.({ user_id: key, status: value.status, at: value.at ?? new Date().toISOString() });
      })
      .on('presence', { event: 'leave' }, ({ key }) => handlers.onPresence?.({ user_id: key, status: 'offline', at: new Date().toISOString() }));
    void channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        void channel.track({ user_id: supabase.auth.getUser().then(({ data }) => data.user?.id ?? ''), status: 'online', at: new Date().toISOString() });
      }
      if (error) console.warn('[communication] realtime subscription error', error);
    });
    return () => { void supabase.removeChannel(channel); };
  },
  async setTyping(conversationId: string, typing: boolean) {
    const channel = supabase.channel(conversationTopic(conversationId), { config: { private: true, broadcast: { self: false, ack: true } } });
    const session = await supabase.auth.getSession();
    const userId = session.data.session?.user.id;
    if (!userId) throw new Error('Authentication required');
    await channel.subscribe();
    try {
      const result = await channel.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId, typing, at: new Date().toISOString() } });
      if (result !== 'ok') throw new Error(`Typing broadcast failed: ${String(result)}`);
    } finally { await supabase.removeChannel(channel); }
  },
  async setPresence(conversationId: string, status: PresenceState['status']) {
    const channel = supabase.channel(conversationTopic(conversationId), { config: { private: true } });
    const session = await supabase.auth.getSession();
    const userId = session.data.session?.user.id;
    if (!userId) throw new Error('Authentication required');
    await channel.subscribe();
    try {
      const result = await channel.track({ user_id: userId, status, at: new Date().toISOString() });
      if (result !== 'ok') throw new Error(`Presence update failed: ${String(result)}`);
    } finally { await supabase.removeChannel(channel); }
  },
};
