import { useCallback, useEffect, useState } from 'react';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { appwriteAuth } from '@/services/appwriteAuth';

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
    try {
      // These are both caller-scoped server predicates. Check the canonical owner
      // predicate even when the richer governance RPC succeeds: a stale or partial
      // governance payload must never hide the verified owner controls.
      const [data, ownerData] = await Promise.all([
        backendCapabilities.call<any>('testagram.governance.read'),
        backendCapabilities.call<boolean>('testagram.governance.is_owner'),
      ]);
      const isOwner = ownerData === true || data?.is_owner === true;
      if (data) {
        setGovernance({
          is_owner: isOwner,
          is_admin: isOwner || data.is_admin === true,
          role: isOwner ? 'owner' : (typeof data.role === 'string' ? data.role : null),
          status: typeof data.status === 'string' ? data.status : null,
          permissions: Array.isArray(data.permissions) ? data.permissions.map(String) : [],
        });
      } else {
        setGovernance(isOwner
          ? { ...EMPTY, is_owner: true, is_admin: true, role: 'owner' }
          : EMPTY);
      }
    } catch {
      setGovernance(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const can = useCallback((permission: string) => governance.is_owner || governance.permissions.includes(permission), [governance]);
  return { governance, loading, refresh, can };
}

export async function getGovernanceForUser(userId: string) {
  const data = await backendCapabilities.call<any>('testagram.governance.read_for_user', { user_id: userId });
  return data as { is_owner?: boolean; is_admin?: boolean; role?: string | null };
}

export async function appointAdministrator(userId: string, role: string, allowPermissions: string[] = [], denyPermissions: string[] = []) {
  return backendCapabilities.call('testagram.governance.admin.appoint', { user_id: userId, role, allow_permissions: allowPermissions, deny_permissions: denyPermissions });
}

export async function inviteStaff(userId: string, role: string, note?: string) {
  return backendCapabilities.call('testagram.governance.staff.invite', { user_id: userId, role, note: note ?? null });
}

export async function terminateStaff(userId: string, reason?: string) {
  return backendCapabilities.call('testagram.governance.staff.terminate', { user_id: userId, reason: reason ?? null });
}

export async function verifyStaffWorkspacePin(pin: string) {
  const data = await backendCapabilities.call<any>('testagram.governance.staff_pin.verify', { pin });
  return data as { success: boolean; code?: string; attempts_remaining?: number };
}

export async function getAuthenticatedUserId() {
  const user = await appwriteAuth.getCurrentUser();
  if (!user) throw new Error('Authentication required');
  return user.$id;
}

export async function setStaffWorkspacePin(userId: string, pin: string) {
  return backendCapabilities.call('testagram.governance.staff_pin.set', { user_id: userId, pin });
}

export async function changeStaffWorkspacePin(currentPin: string, newPin: string) {
  return backendCapabilities.call('testagram.governance.staff_pin.change', { current_pin: currentPin, new_pin: newPin });
}

export async function requestStaffWorkspacePinReset() {
  const data = await backendCapabilities.call<any>('testagram.governance.staff_pin.request_reset');
  return data as { success: boolean; request_id: string; expires_at: string };
}

export async function confirmStaffWorkspacePinReset(requestId: string, code: string, newPin: string) {
  return backendCapabilities.call('testagram.governance.staff_pin.confirm_reset', { request_id: requestId, code, new_pin: newPin });
}

export async function verifyAdminDashboardPin(pin: string) {
  const data = await backendCapabilities.call<any>('testagram.governance.admin_pin.verify', { pin });
  return data as { success: boolean; code?: string; attempts_remaining?: number; locked_until?: string };
}

export async function setAdminDashboardPin(pin: string) {
  return backendCapabilities.call('testagram.governance.admin_pin.set', { pin });
}

export async function changeAdminDashboardPin(currentPin: string, newPin: string) {
  return backendCapabilities.call('testagram.governance.admin_pin.change', { current_pin: currentPin, new_pin: newPin });
}

export async function listJobApplications(status?: string) {
  const result = await backendCapabilities.call<{ items: unknown[] }>('testagram.governance.jobs.list', { status: status ?? null });
  return result.items ?? [];
}

export async function reviewJobApplication(applicationId: string, status: string, note?: string) {
  return backendCapabilities.call('testagram.governance.jobs.review', { application_id: applicationId, status, note: note ?? null });
}

export async function updateAdministrator(userId: string, role: string, status: 'active' | 'suspended' | 'revoked', reason?: string) {
  return backendCapabilities.call('testagram.governance.admin.update', { user_id: userId, role, status, reason: reason ?? null });
}

export async function listAdministrators() {
  const result = await backendCapabilities.call<{ items: any[] }>('testagram.governance.admin.list');
  return (result.items ?? []) as Array<{
    user_id: string; username: string; display_name: string | null; avatar_url: string | null;
    role_name: string; status: string; appointed_at: string; appointed_by: string;
  }>;
}

export async function searchGovernanceUsers(query: string) {
  const result = await backendCapabilities.call<{ items: any[] }>('testagram.governance.users.search', { query, limit: 20 });
  return (result.items ?? []) as Array<{ user_id: string; username: string; display_name: string | null; avatar_url: string | null }>;
}

export async function listGovernanceAudit() {
  const result = await backendCapabilities.call<{ items: any[] }>('testagram.governance.audit.list', { limit: 100 });
  return (result.items ?? []) as Array<{
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
  { value: 'community_admin', label: 'Community Admin', description: 'Community governance and operations' },
  { value: 'security_admin', label: 'Security Admin', description: 'Security and privileged-access controls' },
  { value: 'audit_admin', label: 'Audit Admin', description: 'Read-only governance, finance and operations audit' },
  { value: 'release_ops', label: 'Release Ops', description: 'Production and release operations' },
] as const;

export async function listGovernancePermissions() {
  const result = await backendCapabilities.call<{ items: any[] }>('testagram.governance.permissions.list');
  return (result.items ?? []) as Array<{ key: string; description: string }>;
}
