import { supabase } from "@/lib/supabase";

/**
 * Canonical wallet repository.
 *
 * Monetary mutations are intentionally not performed with browser CRUD.
 * Wallet balances are changed only by authenticated RPCs / trusted Edge
 * Functions so the balance and wallet_transactions rows stay atomic.
 */
export class WalletRepository {
  async getWallet(_userId: string) {
    const { data, error } = await supabase.rpc("get_my_wallet");
    if (error) throw error;
    return data;
  }

  async createWallet(_userId: string) {
    // get_my_wallet is the canonical, idempotent wallet provisioner.
    return this.getWallet(_userId);
  }

  async credit(_userId: string, _amount: number, _reference?: string): Promise<never> {
    throw new Error(
      "Direct wallet credits are disabled. Use the provider settlement Edge Function."
    );
  }

  async debit(_userId: string, _amount: number, _reference?: string): Promise<never> {
    throw new Error(
      "Direct wallet debits are disabled. Use a canonical wallet RPC or payment Edge Function."
    );
  }
}
