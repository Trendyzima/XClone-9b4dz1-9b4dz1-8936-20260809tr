import { backendCapabilities } from '@/services/testagramCapabilityClient';
/** Browser wallet repository. Monetary mutations are performed only by the authenticated Backend ledger. */
export class WalletRepository {
 async getWallet(_userId:string){return backendCapabilities.getWallet(1).then(result=>result.wallet);}
 async createWallet(_userId:string){return this.getWallet(_userId);}
 async credit(_userId:string,_amount:number,_reference?:string):Promise<never>{throw new Error('Direct wallet credits are disabled. Use verified provider settlement through Backend.');}
 async debit(_userId:string,_amount:number,_reference?:string):Promise<never>{throw new Error('Direct wallet debits are disabled. Use a canonical Backend wallet operation.');}
}
