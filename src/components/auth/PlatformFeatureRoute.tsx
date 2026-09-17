import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { usePlatformFeature, type PlatformFeatureKey } from '@/hooks/usePlatformFeature';

interface PlatformFeatureRouteProps {
  feature: PlatformFeatureKey;
  children: React.ReactNode;
}

export function PlatformFeatureRoute({ feature, children }: PlatformFeatureRouteProps) {
  const { allowed, loading } = usePlatformFeature(feature);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
      </div>
    );
  }

  if (!allowed) return <Navigate to="/" replace />;
  return <>{children}</>;
}
