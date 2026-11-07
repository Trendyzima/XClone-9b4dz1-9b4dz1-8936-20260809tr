import { backendCapabilities } from '@/services/testagramCapabilityClient';

export type MatrixTransportStatus = {
  enabled: boolean;
  provider: 'matrix';
  identity: string | null;
};

export type MatrixTransport = {
  status(): Promise<MatrixTransportStatus>;
  syncConversation(conversationId: string): Promise<{ synced: boolean }>;
};

async function callBridge<T>(operation: string, input: Record<string, unknown> = {}): Promise<T> {
  return backendCapabilities.call<T>('testagram.matrix.' + operation, input);
}

export const matrixTransport: MatrixTransport = {
  async status() {
    return callBridge<MatrixTransportStatus>('status');
  },
  syncConversation: conversationId => callBridge<{ synced: boolean }>('sync_conversation', { conversation_id: conversationId }),
};
