# Creator Balance Bridge Reconciliation v1

## Scope

P0 forensic follow-up for the `surgical/platform-treasury-control-v1` branch.

This pass closes the remaining bridge analysis between the legacy creator earning surfaces and the newer `monetization_accounts` / `monetization_ledger` model.

No payout, wallet, M-Pesa, ZenAd, or treasury settlement behavior is changed by this artifact.

## Confirmed balance generations

### Legacy wallet generation

`creator_earnings` can be followed by `add_to_wallet()`, placing creator funds into `wallets`.

The existing `distribute-earnings` Edge Function has two confirmed callers of this legacy bridge:

- video creator-fund distribution: insert `creator_earnings` then call `add_to_wallet()`;
- ad-revenue distribution: insert `creator_earnings` then call `add_to_wallet()`.

These paths therefore remain wallet-authoritative and are not compatible with making `monetization_accounts` the sole creator-payable source without migration.

Classification: **MIGRATE**.

### Older monetization generation

`settle_monetization_event()` credits the creator through `credit_wallet_deposit()`, writes `creator_earnings`, updates `user_monetization` and `revenue_shares`, and increments `platform_treasury`.

Classification: **LEGACY-PROTECTED / MIGRATE**.

Existing records must remain untouched while a canonical replacement is proven.

### New monetization generation

`record_creator_earning()` writes a credit to `monetization_ledger` in `pending` state and increments `monetization_accounts.pending_cents` and `lifetime_earned_cents`.

`release_monetization_pending()` is the confirmed transition from pending to available: it changes ledger state to `available`, decrements `pending_cents`, and increments `available_cents`.

`request_monetization_payout()` then reserves only from `monetization_accounts.available_cents` and records the payout debit in `monetization_ledger`.

Classification: **KEEP — candidate canonical creator-payable lineage**.

## Critical bridge finding

The creator payout UI is not currently using `request_monetization_payout()` as its universal request boundary.

The observed payout surface still:

1. reads `user_monetization.pending_user_payout` as the available creator payout amount;
2. invokes the M-Pesa B2C function for M-Pesa payouts;
3. directly updates `user_monetization.pending_user_payout`;
4. directly inserts `wallet_transactions` for the payout record.

The PayPal branch similarly directly inserts a `wallet_transactions` withdrawal and decrements `user_monetization.pending_user_payout`.

Classification: **MIGRATE**.

## Direct writer matrix

| Writer / bridge | Balance authority | Classification | Required action |
| --- | --- | --- | --- |
| `add_to_wallet()` callers in `distribute-earnings` | `wallets` | MIGRATE | Replace creator credit with canonical earning boundary after source/idempotency mapping |
| `settle_monetization_event()` | `wallets` + legacy monetization tables + `platform_treasury` | LEGACY-PROTECTED / MIGRATE | Keep historical lineage; stop new canonical creator settlement through this path after replacement is proven |
| `record_creator_earning()` | `monetization_accounts` + `monetization_ledger` | KEEP | Candidate canonical earning writer |
| `release_monetization_pending()` | `monetization_accounts` + `monetization_ledger` | KEEP | Candidate canonical availability transition |
| `request_monetization_payout()` | `monetization_accounts` + `monetization_ledger` | KEEP | Candidate canonical reservation boundary |
| `complete_monetization_payout()` | `monetization_payouts` + monetization ledger/account lifetime state | KEEP | Candidate canonical provider completion boundary |
| `fail_monetization_payout()` | monetization ledger/account restoration | KEEP | Candidate canonical failure/refund boundary |
| Payouts UI direct `user_monetization.pending_user_payout` writes | `user_monetization` | MIGRATE | Remove as a monetary authority; read-only compatibility only during migration |
| Payouts UI direct `wallet_transactions` inserts | `wallets` lineage | MIGRATE | Replace with canonical payout request boundary |
| `reserve_wallet_withdrawal()` | `wallets` | MIGRATE | Preserve for legacy adapter only; no new creator-payable authority |
| `reserve_mpesa_withdrawal()` | `wallets` | MIGRATE | Eventually become provider adapter behind canonical payout reservation |
| `finalize_mpesa_withdrawal()` | `wallets` + `wallet_transactions` | MIGRATE | Eventually settle canonical payout clearing, not creator balance |

## P0 gates still open

Before P2:

1. Map every `add_to_wallet()` caller, including any repository/function caller not visible in the current Edge Function audit.
2. Map every direct `user_monetization.pending_user_payout` writer.
3. Map every direct `wallet_transactions` creator-payout writer.
4. Prove whether `pending_user_payout` represents the same economic balance as `monetization_accounts.available_cents`; do not assume equivalence.
5. Prove whether any legacy wallet creator earnings can coexist with monetization-account earnings for the same creator.
6. Prove idempotency of every legacy earning bridge before replacing it.
7. Prove that a failed M-Pesa payout cannot restore both a wallet reservation and a monetization reservation.
8. Freeze the canonical target: `monetization_ledger` → `monetization_accounts` → `monetization_payouts`.

## Authority decision gate

Do not create the P2 canonical creator-payable boundary until the above gates are satisfied.

The intended end state remains:

`earning source → monetization_ledger credit → monetization_accounts pending/available → monetization_payouts reservation → payout clearing → provider settlement`

The old wallet system becomes a migration/compatibility adapter and historical ledger, not a competing creator-payable balance authority.

## Explicit non-actions

- No `financial_*` tables.
- No writable `platform_wallet`.
- No production payout rerouting.
- No ZenAd modifications.
- No deletion or mutation of historical wallet/creator earnings rows.
- No direct change to `PayoutsPage` in this P0 forensic phase.
