import { createClient } from '@supabase/supabase-js';

const required = ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','COMMUNITY_ADMIN_TEST_A_EMAIL','COMMUNITY_ADMIN_TEST_A_PASSWORD','COMMUNITY_ADMIN_TEST_B_EMAIL','COMMUNITY_ADMIN_TEST_B_PASSWORD','COMMUNITY_ADMIN_TEST_COMMUNITY_ID','COMMUNITY_ADMIN_TEST_FORENSIC_KEY'];
for (const name of required) if (!process.env[name]) throw new Error(`MISSING_REQUIRED_SECRET:${name}`);

const url = process.env.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const communityId = process.env.COMMUNITY_ADMIN_TEST_COMMUNITY_ID;
const forensic = createClient(url, process.env.COMMUNITY_ADMIN_TEST_FORENSIC_KEY, { auth: { persistSession: false } });
const client = () => createClient(url, anon, { auth: { persistSession: false } });
const assert = (ok, msg, extra) => { if (!ok) throw new Error(`${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}`); };

async function login(email, password) {
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`AUTH_FAILED:${error.message}`);
  assert(data.user?.id, 'AUTH_USER_MISSING');
  return { c, user: data.user };
}

async function membership(userId) {
  const { data, error } = await forensic.from('community_members').select('community_id,user_id,role,status').eq('community_id', communityId).eq('user_id', userId);
  if (error) throw new Error(`MEMBERSHIP_QUERY_FAILED:${error.message}`);
  return data || [];
}

async function findFreshTarget(excluded) {
  const { data: members, error: memberError } = await forensic.from('community_members').select('user_id').eq('community_id', communityId).limit(5000);
  if (memberError) throw new Error(`MEMBER_LIST_FAILED:${memberError.message}`);
  const blocked = new Set((members || []).map(r => r.user_id));
  for (const id of excluded) blocked.add(id);
  const { data: profiles, error } = await forensic.from('profiles').select('id,username').limit(5000);
  if (error) throw new Error(`PROFILE_LIST_FAILED:${error.message}`);
  const target = (profiles || []).find(p => p.id && !blocked.has(p.id));
  assert(target, 'NO_NON_MEMBER_TARGET_AVAILABLE');
  return target;
}

try {
  const [admin, member] = await Promise.all([
    login(process.env.COMMUNITY_ADMIN_TEST_A_EMAIL, process.env.COMMUNITY_ADMIN_TEST_A_PASSWORD),
    login(process.env.COMMUNITY_ADMIN_TEST_B_EMAIL, process.env.COMMUNITY_ADMIN_TEST_B_PASSWORD),
  ]);
  assert(admin.user.id !== member.user.id, 'TEST_ACCOUNTS_MUST_BE_DISTINCT');
  assert((await membership(admin.user.id)).some(r => r.status === 'active' && ['owner', 'admin'].includes(r.role)), 'ADMIN_FIXTURE_ROLE_INVALID');
  assert((await membership(member.user.id)).some(r => r.status === 'active'), 'MEMBER_FIXTURE_MEMBERSHIP_INVALID');

  const target = await findFreshTarget([admin.user.id, member.user.id]);
  const denied = await member.c.rpc('add_community_members', { p_community_id: communityId, p_user_ids: [target.id] });
  assert(denied.error, 'REGULAR_MEMBER_ADD_RPC_ALLOWED', { data: denied.data });
  assert((await membership(target.id)).length === 0, 'UNAUTHORIZED_RPC_CREATED_MEMBERSHIP');

  const added = await admin.c.rpc('add_community_members', { p_community_id: communityId, p_user_ids: [target.id] });
  if (added.error) throw new Error(`ADMIN_ADD_MEMBER_FAILED:${added.error.message}`);
  let rows = await membership(target.id);
  assert(rows.length === 1 && rows[0].status === 'active' && rows[0].role === 'member', 'ADMIN_MEMBER_STATE_INVALID', { rows });

  const duplicate = await admin.c.rpc('add_community_members', { p_community_id: communityId, p_user_ids: [target.id] });
  if (duplicate.error) throw new Error(`DUPLICATE_ADD_FAILED:${duplicate.error.message}`);
  rows = await membership(target.id);
  assert(rows.length === 1, 'DUPLICATE_MEMBERSHIP_CREATED', { rows });

  console.log(JSON.stringify({ ok: true, checks: ['two authenticated accounts','admin role boundary','regular member RPC denied','admin RPC allowed','membership persisted','duplicate add safe','forensic membership row verified'], communityId, targetUserId: target.id }, null, 2));
} catch (error) {
  console.error(String(error?.stack || error));
  process.exitCode = 1;
}
