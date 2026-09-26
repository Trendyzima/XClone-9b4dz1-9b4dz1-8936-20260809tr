import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
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
    supabase
      .from('user_feature_unlocks')
      .select('is_locked')
      .eq('user_id', user.id)
      .eq('feature_key', featureKey)
      .maybeSingle()
      .then(({ data }) => {
        // Locked only when record explicitly has is_locked = true
        setIsLocked(data?.is_locked === true);
      });
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
    supabase
      .from('user_feature_unlocks')
      .select('feature_key')
      .eq('user_id', user.id)
      .eq('is_locked', true)
      .then(({ data }) => {
        setLockedFeatures((data ?? []).map((r: any) => r.feature_key as FeatureKey));
      });
  }, [user?.id, isReg]);

  return lockedFeatures;
}

// Legacy export kept for compatibility
export function useAllUnlockedFeatures(): FeatureKey[] {
  return [...FEATURE_KEYS];
}
