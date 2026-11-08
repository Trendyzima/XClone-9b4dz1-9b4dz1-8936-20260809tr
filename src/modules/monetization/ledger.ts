/** A client-side mutable ledger is not authoritative. Ledger writes and balances belong to Backend. */
export type LedgerEventType = "wallet_credit" | "wallet_debit" | "feature_charge" | "subscription_charge" | "refund";
export interface LedgerEvent { id: string; userId: string; type: LedgerEventType; amount: number; feature?: string; referenceId?: string; timestamp: number; }
const backendOnly = (): never => { throw new Error("Ledger access is server-only. Read balances and transactions from the authenticated Testagram Backend API."); };
export class Ledger {
  record(_event: LedgerEvent): void { backendOnly(); }
  getUserHistory(_userId: string): LedgerEvent[] { return backendOnly(); }
  getAll(): LedgerEvent[] { return backendOnly(); }
  getBalance(_userId: string): number { return backendOnly(); }
}
