-- Superseded by 20261015160000_unified_search_rpc_contract_reconcile.sql.
-- Keep this historical migration version harmless on environments where it
-- has not yet been applied; the reconciliation migration installs the complete
-- authenticated SECURITY DEFINER RPC with pagination and sorting.
DO $migration$ BEGIN NULL; END $migration$;
