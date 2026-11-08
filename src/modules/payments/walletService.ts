/** Wallet balances are server-owned. This legacy in-memory implementation is intentionally disabled. */
export interface Wallet { userId: string; balance: number; currency: string; }
const backendOnly = (): never => { throw new Error("Wallet operations are unavailable in the client. Use the authenticated Testagram Backend wallet API."); };
export class WalletService {
  getWallet(_userId: string): Wallet { return backendOnly(); }
  credit(_userId: string, _amount: number): Wallet { return backendOnly(); }
  debit(_userId: string, _amount: number): Wallet { return backendOnly(); }
  getBalance(_userId: string): number { return backendOnly(); }
}
