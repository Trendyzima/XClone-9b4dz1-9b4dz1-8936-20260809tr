/** Wallet persistence is exclusively owned by Testagram Backend. */
export class WalletRepository {
  async getWallet(_userId: string): Promise<{ balance?: number } | null> {
    throw new Error("Wallet reads must use the authenticated Testagram Backend API. Direct database access from XClone is disabled.");
  }
  async createWallet(_userId: string): Promise<never> {
    throw new Error("Wallet provisioning is server-only. The Backend owns wallet creation.");
  }
  async credit(_userId: string, _amount: number, _reference?: string): Promise<never> {
    throw new Error("Wallet credits are server-only and require verified provider settlement.");
  }
  async debit(_userId: string, _amount: number, _reference?: string): Promise<never> {
    throw new Error("Wallet debits are server-only and require an atomic Backend ledger transaction.");
  }
}
