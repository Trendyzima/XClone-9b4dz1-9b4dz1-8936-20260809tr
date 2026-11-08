/** Provider callback processing is owned by Testagram Backend. */
export function handleMpesaCallback(_callback: unknown): never {
  throw new Error("M-Pesa callback processing is server-only. Do not process provider callbacks in XClone.");
}
