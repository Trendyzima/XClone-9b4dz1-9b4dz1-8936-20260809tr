import { supabase } from '@/lib/supabase';
import { backendCapabilities, type CapabilityPage } from '@/services/testagramCapabilityClient';

export type CommunicationConversation = {
  id: string;
  created_at: string;
  updated_at: string;
  latest_message?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type CommunicationMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  media_url?: string | null;
  media_type?: string | null;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  reply_to_message_id?: string | null;
  shared_post_id?: string | null;
  client_message_id?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  sender?: Record<string, unknown> | null;
};

export type CallSession = {
  call_id: string;
  provider: 'livekit';
  room_name: string;
};

export const communicationService = {
  listConversations(limit = 50) {
    return backendCapabilities.call<{ items: CommunicationConversation[] }>(
      'testagram.conversations.list',
      { limit },
    );
  },

  createConversation(memberIds: string[]) {
    return backendCapabilities.call<{ conversation_id: string }>(
      'testagram.conversations.create',
      { member_ids: memberIds },
    );
  },

  listMessages(conversationId: string, limit = 50, cursor?: string) {
    return backendCapabilities.call<CapabilityPage<CommunicationMessage>>(
      'testagram.messages.list',
      { conversation_id: conversationId, limit, ...(cursor ? { cursor } : {}) },
    );
  },

  sendMessage(input: {
    conversationId: string;
    body: string;
    clientMessageId?: string;
    replyToMessageId?: string;
    sharedPostId?: string;
  }) {
    return backendCapabilities.call<{ message_id: string }>('testagram.messages.send', {
      conversation_id: input.conversationId,
      body: input.body,
      ...(input.clientMessageId ? { client_message_id: input.clientMessageId } : {}),
      ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
      ...(input.sharedPostId ? { shared_post_id: input.sharedPostId } : {}),
    });
  },

  markMessageRead(messageId: string) {
    return backendCapabilities.call<{ message_id: string; read: boolean }>(
      'testagram.messages.mark_read',
      { message_id: messageId },
    );
  },

  reactToMessage(messageId: string, reaction: string, remove = false) {
    return backendCapabilities.call<{ message_id: string; reaction: string; removed: boolean }>(
      'testagram.messages.react',
      { message_id: messageId, reaction, remove },
    );
  },

  createCall(conversationId: string, kind: 'voice' | 'video' | 'screen' = 'video') {
    return backendCapabilities.call<CallSession>('testagram.calls.create', {
      conversation_id: conversationId,
      kind,
    });
  },

  joinCall(callId: string) {
    return backendCapabilities.call<{ call_id: string; joined: boolean }>('testagram.calls.join', {
      call_id: callId,
    });
  },

  endCall(callId: string) {
    return backendCapabilities.call<{ call_id: string; ended: boolean }>('testagram.calls.end', {
      call_id: callId,
    });
  },

  async getLiveKitToken(callId: string) {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error('Authentication required');
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/livekit-token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ call_id: callId }),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error?.message ?? 'Unable to obtain call token');
    }
    return payload.data as { token: string; url: string; room_name: string };
  },

  subscribeToConversation(conversationId: string, onMessage: (message: CommunicationMessage) => void) {
    const channel = supabase
      .channel(`testagram:conversation:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        payload => onMessage(payload.new as CommunicationMessage),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  },
};
