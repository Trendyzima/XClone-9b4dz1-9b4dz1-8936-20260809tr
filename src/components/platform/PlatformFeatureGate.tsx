import { ReactNode, useEffect, useState } from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Props = {
  feature: string;
  children: ReactNode;
  fallback?: ReactNode;
};

export function PlatformFeatureGate({ feature, children, fallback }: Props) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc('platform_has_feature', { p_feature_key: feature }).then(({ data }) => {
      if (!cancelled) setAllowed(data === true);
    });
    return () => { cancelled = true; };
  }, [feature]);

  if (allowed === null) {
    return <div className="min-h-[40vh] flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!allowed) {
    return fallback ?? (
      <div className="min-h-[40vh] flex items-center justify-center px-6 text-center">
        <div>
          <ShieldAlert className="w-9 h-9 mx-auto mb-3 text-muted-foreground" />
          <h1 className="font-bold text-lg">Restricted platform surface</h1>
          <p className="text-sm text-muted-foreground mt-1">Your active platform role does not grant access to this area.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
