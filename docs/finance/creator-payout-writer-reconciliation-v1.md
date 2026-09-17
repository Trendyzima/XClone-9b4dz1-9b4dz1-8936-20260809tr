# Creator Payout Writer Reconciliation v1

## Scope

This is a forensic P0 reconciliation artifact for the `surgical/platform-treasury-control-v1` branch. It does not change settlement behavior, payout authority, provider callbacks, or legacy ZenAd tables.

## Confirmed live payout models

| Model | Request boundary | Balance source | Reservation/write | Provider completion | Failure behavior | Classification |
| --- | --- | --- | --- | --- | --- | --- |
| Monetization payout | `request_monetization_payout(p_amount_cents, p_provider, p_destination, p_idempotency_key)` | `monetization_accounts.available_cents` | inserts `monetization_payouts`; inserts `monetization_ledger` payout debit; decrements `available_cents` | `complete_monetization_payout` marks payout paid and updates lifetime paid / ledger provider reference | `fail_monetization_payout` inserts reversal adjustment and restores `available_cents` | **Candidate canonical creator-payable model** |
| Legacy wallet payout | `request_creator_payout(p_amount, p_currency, p_provider, p_destination)` | `wallets.balance` | calls `reserve_wallet_withdrawal`, creates `wallet_transactions`, inserts `creator_payouts` | approval path is `platform_approve_creator_payout`; downstream provider settlement uses wallet withdrawal functions | rejection/failure routes through wallet withdrawal failure/refund | **Legacy / must be migrated before treasury authority** |

## Critical divergence

The two request paths do not reserve the same balance.

- `request_monetization_payout` reserves creator funds from `monetization_accounts.available_cents` and records the reservation in `monetization_ledger`.
- `request_creator_payout` reserves from `wallets.balance` and records a `wallet_transactions` withdrawal.

Therefore these paths cannot safely be treated as interchangeable payout APIs. Making Platform Treasury authoritative before reconciling them would create a second/third balance authority rather than remove one.

## Provider boundary

The live M-Pesa wallet withdrawal boundary currently operates on `wallet_transactions` + `wallets`:

- `reserve_mpesa_withdrawal` locks the wallet, checks balance/status/currency, decrements `wallets.balance`, and inserts a pending `wallet_transactions` withdrawal.
- `finalize_mpesa_withdrawal` completes the transaction on provider success or restores the wallet balance and marks the transaction refunded on failure.

This is structurally compatible with the legacy `creator_payouts` model, not with `monetization_payouts` directly.

## Existing creator earning split

There are also two earning writers:

1. `settle_monetization_event` (older path): splits gross into creator/platform amounts, credits the creator through `credit_wallet_deposit`, writes `creator_earnings`, `user_monetization`, `revenue_shares`, and increments `platform_treasury`.
2. `record_creator_earning` (newer path): splits gross into creator/platform amounts, writes `monetization_ledger`, and increments `monetization_accounts.pending_cents` / lifetime earned.

This means payout reconciliation must include the earning writer, not only the payout request writer. Otherwise a payout can be requested against a balance that was produced by a different accounting model.

## Current production data check

At the time of this audit, production contains zero rows in:

- `monetization_accounts`
- `monetization_payouts`
- `creator_payouts`

This means there is currently no live creator payout balance to migrate, but the writer conflict still exists in schema/function code and must be resolved before activation.

## P0 migration gate

Do **not** make Platform Treasury the universal payout authority until all of the following are proven:

1. Every caller of `request_monetization_payout` is mapped.
2. Every caller of `request_creator_payout` is mapped.
3. Every caller/direct writer of `wallets` and `wallet_transactions` involved in creator payout is mapped.
4. Every caller of `complete_monetization_payout` / `fail_monetization_payout` is mapped.
5. Every provider callback/settlement path for creator payout is mapped, including M-Pesa.
6. A single creator-payable source is selected and the other balance mechanism is explicitly marked legacy/migration-only.
7. Failure/refund semantics are proven to restore exactly one reservation, not both.
8. Idempotency is proven across request → reservation → provider completion/failure.

## Required next surgical operation

Build a caller-level matrix from repository source and classify each writer as:

- **KEEP** — canonical path to retain;
- **MIGRATE** — caller must be moved to the canonical payout boundary;
- **DEPRECATE** — compatibility wrapper retained temporarily but no new writes;
- **LEGACY-PROTECTED** — existing records remain untouched while lineage is proven.

No new `financial_*` tables and no writable `platform_wallet` should be introduced during this phase.

## Authority target after P0

The eventual target is:

`creator earning → canonical creator payable → payout reservation → payout clearing → provider settlement`

Platform Treasury becomes the custody/control boundary inside that single authority; it must not become a third independent balance ledger.
