import { backendCapabilities } from '@/services/testagramCapabilityClient';

export type WalletProjection = {
  id: string;
  balance: number;
  currency?: string | null;
  [key: string]: unknown;
};

/** Browser wallet repository. Monetary mutations are performed only by the authenticated Backend ledger. */
export class WalletRepository {
  async getWallet(_userId: string): Promise<WalletProjection | null> {
    const result = await backendCapabilities.getWallet(1);
    const wallet = result.wallet;
    if (!wallet || typeof wallet !== 'object') return null;
    const projection = wallet as Record<string, unknown>;
    if (typeof projection.id !== 'string' || typeof projection.balance !== 'number') return null;
    return projection as WalletProjection;
  }

  async createWallet(_userId: string): Promise<WalletProjection | null> {
    // Wallet provisioning is an authenticated Backend responsibility.
    return this.getWallet(_userId);
  }

  async credit(_userId: string, _amount: number, _reference?: string): Promise<never> {
    throw new Error('Direct wallet credits are disabled. Use verified provider settlement through Backend.');
  }

  async debit(_userId: string, _amount: number, _reference?: string): Promise<never> {
    throw new Error('Direct wallet debits are disabled. Use a canonical Backend wallet operation.');
  }
}
