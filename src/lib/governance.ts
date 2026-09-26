import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type GovernanceState = {
  is_owner: boolean;
  is_admin: boolean;
  role: string | null;
  status: string | null;
  permissions: string[];
};

const EMPTY: GovernanceState = { is_owner: false, is_admin: false, role: null, status: null, permissions: [] };

export function useGovernance() {
  const [governance, setGovernance] = useState<GovernanceState>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('testagram_get_governance');
    if (!error && data) {
      setGovernance({
        is_owner: data.is_owner === true,
        is_admin: data.is_admin === true,
        role: typeof data.role === 'string' ? data.role : null,
        status: typeof data.status === 'string' ? data.status : null,
        permissions: Array.isArray(data.permissions) ? data.permissions.map(String) : [],
      });
    } else setGovernance(EMPTY);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const can = useCallback((permission: string) => governance.is_owner || governance.permissions.includes(permission), [governance]);
  return { governance, loading, refresh, can };
}

export async function getGovernanceForUser(userId: string) {
  const { data, error } = await supabase.rpc('testagram_get_governance_for_user', { p_user_id: userId });
  if (error) throw error;
  return data as { is_owner?: boolean; is_admin?: boolean; role?: string | null };
}

export async function appointAdministrator(userId: string, role: string, allowPermissions: string[] = [], denyPermissions: string[] = []) {
  const { data, error } = await supabase.rpc('testagram_appoint_admin_v2', { p_user_id: userId, p_role_name: role, p_allow_permissions: allowPermissions, p_deny_permissions: denyPermissions });
  if (error) throw error;
  return data;
}

export async function updateAdministrator(userId: string, role: string, status: 'active' | 'suspended' | 'revoked', reason?: string) {
  const { data, error } = await supabase.rpc('testagram_update_admin', {
    p_user_id: userId, p_role_name: role, p_status: status, p_reason: reason ?? null,
  });
  if (error) throw error;
  return data;
}

export async function listAdministrators() {
  const { data, error } = await supabase.rpc('testagram_list_admins');
  if (error) throw error;
  return (data ?? []) as Array<{
    user_id: string; username: string; display_name: string | null; avatar_url: string | null;
    role_name: string; status: string; appointed_at: string; appointed_by: string;
  }>;
}

export async function searchGovernanceUsers(query: string) {
  const { data, error } = await supabase.rpc('testagram_search_governance_users', { p_query: query, p_limit: 20 });
  if (error) throw error;
  return (data ?? []) as Array<{ user_id: string; username: string; display_name: string | null; avatar_url: string | null }>;
}

export async function listGovernanceAudit() {
  const { data, error } = await supabase.rpc('testagram_governance_audit', { p_limit: 100 });
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string; actor_user_id: string | null; actor_username: string | null; action: string;
    target_user_id: string | null; target_username: string | null; role_name: string | null;
    reason: string | null; metadata: Record<string, unknown>; created_at: string;
  }>;
}

export const GOVERNANCE_ROLES = [
  { value: 'moderator', label: 'Moderator', description: 'Content, reports and user restrictions' },
  { value: 'support_admin', label: 'Support Admin', description: 'Support and account assistance' },
  { value: 'finance_admin', label: 'Finance Admin', description: 'Financial administration and reconciliation' },
  { value: 'content_admin', label: 'Content Admin', description: 'Publisher and editorial operations' },
  { value: 'trust_safety', label: 'Trust & Safety', description: 'Trust, safety and enforcement' },
  { value: 'operations_admin', label: 'Operations Admin', description: 'Platform, live and system operations' },
  { value: 'super_admin', label: 'Super Admin', description: 'Broad operational administration' },
] as const;

export async function listGovernancePermissions() {
  const { data, error } = await supabase.rpc('testagram_list_governance_permissions');
  if (error) throw error;
  return (data ?? []) as Array<{ key: string; description: string }>;
}
