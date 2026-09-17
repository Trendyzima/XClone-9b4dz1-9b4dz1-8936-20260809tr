# Testagram Financial Core — Forensic Baseline

Status: investigation baseline; no production financial behavior changed by this document.

## Objective

Establish one canonical financial authority inside Testagram without importing an external wallet/ledger database and without altering legacy ZenAd financial/impression lineage before the current ad chain is proven end-to-end.

## Confirmed source findings

### 1. Monetization ledger is not a financial authority

`src/modules/monetization/ledger.ts` is an in-memory `LedgerEvent[]` with wallet/feature event types and a derived per-user balance. It has no persistent journal, account model, debit/credit lines, database transaction boundary, holds, reconciliation, or durable idempotency.

Disposition: `TRANSITIONAL / COMPATIBILITY`; do not promote it to the financial source of truth as-is.

### 2. There are multiple wallet mutation paths

`src/modules/payments/walletService.ts` maintains an in-memory `Record<string, Wallet>` and directly mutates balances.

Disposition: `UNSAFE / LEGACY`; it must not be an authority for real money and should be removed from monetary execution paths after callers are migrated.

`src/modules/payments/walletRepository.ts` persists balances in `wallets` and records entries in `transactions`, but updates the balance and inserts the transaction as separate application operations.

Disposition: `TRANSITIONAL`; preserve data, but move authoritative mutations behind an atomic financial-core boundary.

`src/modules/payments/walletService.db.ts` wraps the repository and exposes compatibility functions such as `deductFromWallet` and `creditWalletFromMpesa`.

Disposition: `TRANSITIONAL`; keep while callers migrate to canonical financial commands.

### 3. Current wallet schema is a balance projection plus generic transaction history

Migration `20260826_wallet.sql` creates `wallets(id,user_id,balance,currency,...)` and `transactions(id,user_id,amount,type,reference,status,...)`.

Disposition: existing data model to reconcile, not assumed to be double-entry accounting.

### 4. P2P transfer already has a stronger transactional pattern

Migration `20260915_add_secure_p2p_wallet_transfer.sql` locks both wallets with `FOR UPDATE`, orders the locks deterministically, updates both balances, and writes paired `wallet_transactions` rows in one PostgreSQL function.

This is a useful implementation pattern for the future financial-core transaction boundary, but it is still balance-ledger logic rather than a complete double-entry financial journal.

### 5. Monetization idempotency is process-local

`src/modules/monetization/idempotency.ts` stores keys in an in-memory object. This cannot be the final idempotency authority for M-Pesa settlement or other monetary operations.

Disposition: `TRANSITIONAL`; durable uniqueness/idempotency must move to the database transaction boundary.

### 6. Fraud currently observes wallet transaction history

`src/modules/monetization/fraudDetection.ts` reads recent `wallet_transactions` and applies amount/velocity/account-history/phone-format rules.

Disposition: `TRANSITIONAL`; retain the rule engine but feed it canonical financial events/transactions so activity cannot bypass risk visibility through another monetary path.

### 7. Feature charging can debit before feature execution

`src/modules/monetization/walletMiddleware.ts` checks access, deducts the feature cost, then executes the feature. Failure handling currently only rethrows and describes refund logic as optional.

Disposition: `UNSAFE`; migrate feature charging to an authorize/commit/refund or equivalent atomic financial command.

## Canonical target boundary

Testagram Financial Core becomes the only authoritative monetary mutation boundary.

External payment providers are rails/adapters.
Wallets are user-facing financial accounts/projections.
ZenAd is a serving/decision consumer and never the financial authority.
Admin UI issues authorized financial commands and never edits balances directly.

## Required canonical domains

- financial_accounts
- financial_transactions
- financial_journal_entries
- financial_journal_lines
- financial_holds
- financial_idempotency_keys
- financial_external_events
- financial_reconciliation_runs
- financial_audit_log

These are targets only. Do not create them until the existing schema/writer lineage audit is complete.

## Money-flow classification

Every monetary writer must be classified as exactly one of:

- CANONICAL
- TRANSITIONAL
- DUPLICATED
- LEGACY
- UNSAFE
- READ-ONLY

The audit must trace at minimum:

M-Pesa -> payment intent/settlement -> wallet -> wallet transactions -> advertiser funding -> ad campaign budget -> ZenAd serving -> impression -> click -> spend -> creator earnings -> payout -> external settlement.

## Hard safety gates

1. Do not delete or rewrite legacy ZenAd financial/impression tables during this phase.
2. Do not introduce a second external financial database.
3. Do not allow application code to become a second balance authority.
4. Do not manually activate or fund production ads for testing.
5. Do not treat client-visible balances as accounting truth.
6. Do not migrate historical money until lineage and reconciliation rules are documented.
7. Every new monetary command must be idempotent and auditable.

## Next forensic operation

Complete the repository-wide writer/read map for wallet, payment, advertising, creator earnings, payout, and ZenAd financial/impression tables. For each table identify schema owner, writers, readers, RPCs/functions, triggers, and current production role.

Only after that map is complete should the first Financial Core migration be authored.
