/** Fraud scoring is security-sensitive and must execute on the server, never in XClone. */
export type FraudCheckResult = { allowed: boolean; reason?: string; riskScore: number; };
export class FraudDetectionEngine {
  async evaluatePayment(_input: { userId: string; amount: number; phone: string }): Promise<FraudCheckResult> {
    throw new Error("Payment risk evaluation is server-only. The Backend must authorize every payment.");
  }
  evaluateAmountOnly(_amount: number): FraudCheckResult {
    throw new Error("Payment risk evaluation is server-only. Client-side amount heuristics are not authorization.");
  }
}
export const fraudDetection = new FraudDetectionEngine();
