/** Payment transaction state is durable server data; browser memory is not a transaction store. */
export interface Transaction { id: string; checkoutRequestID: string; amount: number; phone: string; receipt?: string; status: "pending" | "success" | "failed"; createdAt: number; }
const backendOnly = (): never => { throw new Error("Payment transaction operations are server-only. Use the Testagram Backend payments API."); };
export function createTransaction(_data: Omit<Transaction, "status" | "createdAt">): Transaction { return backendOnly(); }
export function updateTransactionStatus(_checkoutRequestID: string, _status: Transaction["status"], _receipt?: string): Transaction | null { return backendOnly(); }
export function getTransaction(_checkoutRequestID: string): Transaction | undefined { return backendOnly(); }
