/** Provider callbacks are HTTP server routes, not frontend modules. */
export async function mpesaCallbackHandler(_req: unknown, _res: unknown): Promise<never> {
  throw new Error("M-Pesa callback handler was removed from the client. Configure the Backend provider callback route.");
}
