import { useState, useEffect } from 'react';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { useAuth } from '@/hooks/useAuth';
import { useGovernance } from '@/lib/governance';

// The platform regulator username — esbuild-safe module constant
// Legacy regulator access is now backed by the Testagram governance owner record.

// All available platform feature keys — module scope (esbuild guard)
export const FEATURE_KEYS = [
  'live_transcription',
  'nft_badges',
  'podcast_analytics',
  'superchat',
  'community_shop',
  'advanced_monetization',
  'creator_dashboard',
  'federation',
  'ad_management',
  'analytics_export',
] as const;
export type FeatureKey = typeof FEATURE_KEYS[number];

export const FEATURE_LABELS: { [k: string]: string } = {
  live_transcription:    '🎙️ Live Transcription',
  nft_badges:            '🏅 NFT Badges',
  podcast_analytics:     '📊 Podcast Analytics',
  superchat:             '💬 SuperChat',
  community_shop:        '🛒 Community Shop',
  advanced_monetization: '💰 Advanced Monetization',
  creator_dashboard:     '🎬 Creator Dashboard',
  federation:            '🌐 Federation (ActivityPub)',
  ad_management:         '📣 Ad Management',
  analytics_export:      '📤 Analytics Export',
};

export function useIsRegulator() {
  const { governance } = useGovernance();
  return governance.is_owner;
}

// Use this when a privileged page must distinguish "still resolving" from
// "confirmed not owner". Without this, owner-only pages can redirect to Home
// during the first render while the governance RPC is still loading.
export function useRegulatorAccess() {
  const { governance, loading } = useGovernance();
  return { isRegulator: governance.is_owner, loading };
}
// Features are UNLOCKED BY DEFAULT — only returns false if regulator has explicitly locked the feature
export function useFeatureUnlock(featureKey: FeatureKey): boolean {
  const { user } = useAuth();
  const isReg = useIsRegulator();
  // Default: unlocked (true). Only false if an explicit lock record exists.
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    if (!user) { setIsLocked(false); return; }
    // Regulator always has access to everything
    if (isReg) { setIsLocked(false); return; }
    backendCapabilities.call<{ is_locked?: boolean }>('testagram.features.unlock.read', { feature_key: featureKey })
      .then(data => setIsLocked(data?.is_locked === true))
      .catch(() => setIsLocked(false));
  }, [user?.id, featureKey, isReg]);

  return !isLocked; // true = unlocked (feature available)
}

// Bulk fetch locked features for a user
export function useLockedFeatures(): FeatureKey[] {
  const { user } = useAuth();
  const isReg = useIsRegulator();
  const [lockedFeatures, setLockedFeatures] = useState<FeatureKey[]>([]);

  useEffect(() => {
    if (!user || isReg) { setLockedFeatures([]); return; }
    backendCapabilities.call<{ items?: Array<{ feature_key: FeatureKey }> }>('testagram.features.unlock.list')
      .then(data => setLockedFeatures((data.items ?? []).map(row => row.feature_key)))
      .catch(() => setLockedFeatures([]));
  }, [user?.id, isReg]);

  return lockedFeatures;
}

// Legacy export kept for compatibility
export function useAllUnlockedFeatures(): FeatureKey[] {
  return [...FEATURE_KEYS];
}
