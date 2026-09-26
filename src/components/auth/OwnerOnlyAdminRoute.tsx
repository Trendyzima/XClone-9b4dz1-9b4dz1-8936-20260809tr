import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useGovernance } from '@/lib/governance';

export function OwnerOnlyAdminRoute({ children }: { children: ReactNode }) {
  const { governance, loading } = useGovernance();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  if (!governance.is_owner) return <Navigate to="/admin/governance" replace />;
  return <>{children}</>;
}
