export type MatrixTransportStatus = { enabled: boolean; provider: 'matrix'; identity: string | null };
export type MatrixTransport = {
  status(): Promise<MatrixTransportStatus>;
  syncConversation(conversationId: string): Promise<{ synced: boolean }>;
};

// Matrix is not one of Testagram's five service repositories. Until Backend
// owns an approved Matrix bridge adapter, the client must not contact a
// separately configured bridge or forward Appwrite credentials to it.
export const matrixTransport: MatrixTransport = {
  async status() { return { enabled: false, provider: 'matrix', identity: null }; },
  async syncConversation(_conversationId: string) {
    throw new Error('Matrix transport is not enabled through the Testagram Backend API.');
  },
};
