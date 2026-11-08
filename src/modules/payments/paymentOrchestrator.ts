/** M-Pesa settlement and wallet crediting must never execute in the browser. */
export async function processMpesaPayment(_callbackData: unknown): Promise<never> {
  throw new Error("M-Pesa settlement is server-only. Safaricom callbacks must terminate at the Testagram Backend.");
}
