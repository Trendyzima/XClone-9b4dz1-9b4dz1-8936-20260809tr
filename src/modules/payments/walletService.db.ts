import { WalletRepository } from "./walletRepository";

const repo = new WalletRepository();

export class WalletServiceDB {
  async creditFromMpesa(userId: string, amount: number, reference: string) {
    return await repo.credit(userId, amount, reference);
  }

  async debit(userId: string, amount: number, reference?: string) {
    return await repo.debit(userId, amount, reference);
  }

  async getBalance(userId: string) {
    const wallet = await repo.getWallet(userId);
    return wallet?.balance || 0;
  }

  async ensureWallet(userId: string) {
    const wallet = await repo.getWallet(userId);
    if (!wallet) return await repo.createWallet(userId);
    return wallet;
  }
}

// Backwards-compatible functional exports used by legacy monetization/payment callers.
const service = new WalletServiceDB();
export const getWalletBalance = (userId: string) => service.getBalance(userId);
export const deductFromWallet = (userId: string, amount: number, reference?: string) => service.debit(userId, amount, reference);
export const creditWalletFromMpesa = (userId: string, amount: number, reference: string) => service.creditFromMpesa(userId, amount, reference);
