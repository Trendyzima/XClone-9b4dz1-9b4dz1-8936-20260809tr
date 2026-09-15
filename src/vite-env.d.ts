/// <reference types="vite/client" />

// Canonical Vite environment contract for the web typecheck gate.
// CI trigger marker: rerun the complete Quality Gate against the repaired tree.
// Self-heal marker: deterministic contract repair runs before compiler verification.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_GIPHY_API_KEY?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
