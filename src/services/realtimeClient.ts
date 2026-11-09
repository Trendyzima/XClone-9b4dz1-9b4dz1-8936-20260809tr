import { backendCapabilities } from '@/services/testagramCapabilityClient';

export type TestagramRealtimeEvent = {
  type: string;
  event_id?: string;
  occurred_at?: string;
  payload?: Record<string, unknown>;
};

export type ConversationRealtimeConnection = { close: () => void };

export async function subscribeConversationRealtime(
  conversationId: string,
  onEvent: (event: TestagramRealtimeEvent) => void,
  onStatus?: (status: 'connecting' | 'connected' | 'closed' | 'error') => void,
): Promise<ConversationRealtimeConnection> {
  if (!conversationId) throw new Error('Conversation ID is required');
  if (typeof WebSocket === 'undefined') throw new Error('Realtime WebSocket is unavailable in this environment');
  onStatus?.('connecting');
  const ticket = await backendCapabilities.getConversationRealtimeTicket(conversationId);
  if (!ticket?.ticket || !ticket?.websocket_url) throw new Error('Backend did not issue a conversation realtime ticket');

  const socket = new WebSocket(ticket.websocket_url, ['testagram.realtime.v1', `ticket.${ticket.ticket}`]);
  let heartbeat: number | null = null;
  let closed = false;
  socket.onopen = () => {
    onStatus?.('connected');
    heartbeat = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, 20000);
  };
  socket.onmessage = message => {
    try {
      const event = JSON.parse(String(message.data)) as TestagramRealtimeEvent;
      if (event && typeof event.type === 'string') onEvent(event);
    } catch { /* Ignore malformed or unsupported realtime frames. */ }
  };
  socket.onerror = () => onStatus?.('error');
  socket.onclose = () => {
    if (heartbeat !== null) window.clearInterval(heartbeat);
    heartbeat = null;
    if (!closed) onStatus?.('closed');
  };
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      socket.close();
      reject(new Error('Conversation realtime connection timed out'));
    }, 12000);
    socket.addEventListener('open', () => { window.clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { window.clearTimeout(timeout); reject(new Error('Could not connect to conversation realtime')); }, { once: true });
  });
  return {
    close: () => {
      closed = true;
      if (heartbeat !== null) window.clearInterval(heartbeat);
      heartbeat = null;
      socket.close(1000, 'client closed');
    },
  };
}
