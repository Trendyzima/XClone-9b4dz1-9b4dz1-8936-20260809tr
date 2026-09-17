-- Account lifecycle state is intentionally separate from profile_features.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_account_status_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IN ('active', 'deactivated'));

CREATE INDEX IF NOT EXISTS profiles_account_status_idx
  ON public.profiles(account_status);

-- Deactivated profiles are hidden by application queries; ownership/RLS remains unchanged.
COMMENT ON COLUMN public.profiles.account_status IS 'Account lifecycle state. Separate from profile_features.';
COMMENT ON COLUMN public.profiles.deactivated_at IS 'Timestamp when the owner deactivated the account.';
