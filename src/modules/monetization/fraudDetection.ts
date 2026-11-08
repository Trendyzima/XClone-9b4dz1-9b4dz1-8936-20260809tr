/**
 * Production-grade fraud detection layer (rule-based baseline)
 * Protects wallet + monetization system from abuse patterns.
 *
 * esbuild-safe: no Set<T> generics, no useState<T>, no useRef<T>.
 * Payment risk is evaluated by Backend; browser heuristics are never authoritative.
 */
import { backendCapabilities } from '@/services/testagramCapabilityClient';

// ── Result type ──────────────────────────────────────────────────────────
export type FraudCheckResult = {
  allowed: boolean;
  reason?: string;
  riskScore: number;
};

// ── Pure risk rules (module-level constants, esbuild-safe) ───────────────
const RULE_HIGH_AMOUNT     = 40;  // +40 risk if amount > 50,000 KES
const RULE_RAPID_FIRE      = 30;  // +30 risk if 5+ recent transactions
const RULE_NEW_USER        = 20;  // +20 risk if no transaction history
const RULE_FOREIGN_PHONE   = 10;  // +10 risk if phone doesn't start with 254
const RISK_BLOCK_THRESHOLD = 70;  // block if total risk >= 70

// ── Engine ───────────────────────────────────────────────────────────────
export class FraudDetectionEngine {
  async evaluatePayment(input: {
    userId: string;
    amount: number;
    phone: string;
  }): Promise<FraudCheckResult> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Invalid payment amount');
    const result = await backendCapabilities.call<FraudCheckResult>('testagram.wallet.fraud.evaluate', {
      amount: input.amount,
      phone: input.phone,
    });
    return result;
  }

  // Lightweight synchronous check for amount-only heuristics
  evaluateAmountOnly(amount: number): FraudCheckResult {
    let riskScore = 0;
    if (amount > 50000) riskScore += RULE_HIGH_AMOUNT;
    return {
      allowed: riskScore < RISK_BLOCK_THRESHOLD,
      riskScore,
      reason: riskScore >= RISK_BLOCK_THRESHOLD ? 'Amount exceeds safe threshold' : undefined,
    };
  }
}

export const fraudDetection = new FraudDetectionEngine();
