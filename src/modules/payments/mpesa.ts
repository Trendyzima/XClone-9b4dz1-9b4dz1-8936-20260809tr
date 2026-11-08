import type { MpesaConfig, PaymentResponse } from "./types";
/** Safaricom credentials, STK initiation and callback verification are server-only. */
export class MpesaService {
  constructor(_config: MpesaConfig) {
    throw new Error("M-Pesa provider integration is server-only. Configure credentials and callbacks in Testagram Backend.");
  }
  async stkPush(_phone: string, _amount: number): Promise<PaymentResponse> {
    throw new Error("M-Pesa STK Push must be initiated by the authenticated Testagram Backend API.");
  }
}
