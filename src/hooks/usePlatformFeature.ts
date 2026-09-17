import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

export type PlatformFeatureKey =
  | 'platform.overview'
  | 'platform.roles'
  | 'platform.users'
  | 'platform.moderation'
  | 'platform.verification'
  | 'platform.ads'
  | 'platform.finance'
  | 'platform.analytics'
  | 'platform.fraud'
  | 'platform.operations'
  | 'platform.support'
  | 'platform.audit'
  | 'platform.settings';

export function usePlatformFeatures() {
  const { user } = useAuth();
  const [features, setFeatures] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setFeatures(new Set());
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data } = await supabase
      .from('platform_feature_assignments')
      .select('feature_key')
      .eq('user_id', user.id)
      .eq('active', true);

    setFeatures(new Set((data ?? []).map((row) => row.feature_key)));
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasFeature = useCallback(
    (feature: PlatformFeatureKey | string) => features.has(feature),
    [features],
  );

  return { features, loading, hasFeature, refresh: load };
}

export function usePlatformFeature(feature: PlatformFeatureKey | string) {
  const { user } = useAuth();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      if (!user) {
        if (mounted) {
          setAllowed(false);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      const { data, error } = await supabase.rpc('platform_has_feature', {
        p_feature_key: feature,
        p_user_id: user.id,
      });

      if (mounted) {
        setAllowed(!error && data === true);
        setLoading(false);
      }
    };

    void check();
    return () => { mounted = false; };
  }, [user?.id, feature]);

  return { allowed, loading };
}
