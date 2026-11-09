import { useCallback, useEffect, useState } from 'react';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { appwriteAuth } from '@/services/appwriteAuth';

export type GovernanceState = { is_owner: boolean; is_admin: boolean; role: string | null; status: string | null; permissions: string[] };
const EMPTY: GovernanceState = { is_owner: false, is_admin: false, role: null, status: null, permissions: [] };
const invoke = <T = any>(capability: string, input: Record<string, unknown> = {}) => backendCapabilities.call<T>(capability, input);

export function useGovernance() {
  const [governance, setGovernance] = useState<GovernanceState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<GovernanceState>('testagram.governance.read');
      const owner = data?.is_owner === true;
      setGovernance({ is_owner: owner, is_admin: owner || data?.is_admin === true, role: owner ? 'owner' : data?.role ?? null, status: data?.status ?? null, permissions: Array.isArray(data?.permissions) ? data.permissions : [] });
    } catch { setGovernance(EMPTY); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const can = useCallback((permission: string) => governance.is_owner || governance.permissions.includes(permission), [governance]);
  return { governance, loading, refresh, can };
}

export async function getGovernanceForUser(userId: string) { return invoke<{is_owner?:boolean;is_admin?:boolean;role?:string|null}>('testagram.governance.user.read',{user_id:userId}); }
export async function appointAdministrator(userId:string,role:string,allowPermissions:string[]=[],denyPermissions:string[]=[]){return invoke('testagram.governance.admin.appoint',{user_id:userId,role,allow_permissions:allowPermissions,deny_permissions:denyPermissions});}
export async function inviteStaff(userId:string,role:string,note?:string){return invoke('testagram.governance.staff.invite',{user_id:userId,role,note:note??null});}
export async function terminateStaff(userId:string,reason?:string){return invoke('testagram.governance.staff.terminate',{user_id:userId,reason:reason??null});}
export async function verifyStaffWorkspacePin(pin:string){return invoke<{success:boolean;code?:string;attempts_remaining?:number}>('testagram.governance.staff_pin.verify',{pin});}
export async function getAuthenticatedUserId(){const user=await appwriteAuth.getCurrentUser();if(!user)throw new Error('Authentication required');return user.$id;}
export async function setStaffWorkspacePin(userId:string,pin:string){return invoke('testagram.governance.staff_pin.set',{user_id:userId,pin});}
export async function changeStaffWorkspacePin(currentPin:string,newPin:string){return invoke('testagram.governance.staff_pin.change',{current_pin:currentPin,new_pin:newPin});}
export async function requestStaffWorkspacePinReset(){return invoke<{success:boolean;request_id:string;expires_at:string}>('testagram.governance.staff_pin.reset.request');}
export async function confirmStaffWorkspacePinReset(requestId:string,code:string,newPin:string){return invoke('testagram.governance.staff_pin.reset.confirm',{request_id:requestId,code,new_pin:newPin});}
export async function verifyAdminDashboardPin(pin:string){return invoke<{success:boolean;code?:string;attempts_remaining?:number;locked_until?:string}>('testagram.governance.dashboard_pin.verify',{pin});}
export async function setAdminDashboardPin(pin:string){return invoke('testagram.governance.dashboard_pin.set',{pin});}
export async function changeAdminDashboardPin(currentPin:string,newPin:string){return invoke('testagram.governance.dashboard_pin.change',{current_pin:currentPin,new_pin:newPin});}
export async function listJobApplications(status?:string){return invoke('testagram.governance.jobs.list',{status:status??null});}
export async function reviewJobApplication(applicationId:string,status:string,note?:string){return invoke('testagram.governance.jobs.review',{application_id:applicationId,status,note:note??null});}
export async function updateAdministrator(userId:string,role:string,status:'active'|'suspended'|'revoked',reason?:string){return invoke('testagram.governance.admin.update',{user_id:userId,role,status,reason:reason??null});}
export async function listAdministrators(){return invoke<Array<{user_id:string;username:string;display_name:string|null;avatar_url:string|null;role_name:string;status:string;appointed_at:string;appointed_by:string}>>('testagram.governance.admin.list');}
export async function searchGovernanceUsers(query:string){return invoke<Array<{user_id:string;username:string;display_name:string|null;avatar_url:string|null}>>('testagram.governance.users.search',{query,limit:20});}
export async function listGovernanceAudit(){return invoke<Array<{id:string;actor_user_id:string|null;actor_username:string|null;action:string;target_user_id:string|null;target_username:string|null;role_name:string|null;reason:string|null;metadata:Record<string,unknown>;created_at:string}>>('testagram.governance.audit.list',{limit:100});}
export const GOVERNANCE_ROLES = [
  {value:'moderator',label:'Moderator',description:'Content, reports and user restrictions'},
  {value:'support_admin',label:'Support Admin',description:'Support and account assistance'},
  {value:'finance_admin',label:'Finance Admin',description:'Financial administration and reconciliation'},
  {value:'content_admin',label:'Content Admin',description:'Publisher and editorial operations'},
  {value:'trust_safety',label:'Trust & Safety',description:'Trust, safety and enforcement'},
  {value:'operations_admin',label:'Operations Admin',description:'Platform, live and system operations'},
  {value:'super_admin',label:'Super Admin',description:'Broad operational administration'},
  {value:'community_admin',label:'Community Admin',description:'Community governance and operations'},
  {value:'security_admin',label:'Security Admin',description:'Security and privileged-access controls'},
  {value:'audit_admin',label:'Audit Admin',description:'Read-only governance, finance and operations audit'},
  {value:'release_ops',label:'Release Ops',description:'Production and release operations'},
] as const;
export async function listGovernancePermissions(){return invoke<Array<{key:string;description:string}>>('testagram.governance.permissions.list');}
