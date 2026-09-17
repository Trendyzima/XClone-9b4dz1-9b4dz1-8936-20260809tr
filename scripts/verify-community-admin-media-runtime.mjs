import { createClient } from '@supabase/supabase-js';

const required = ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','COMMUNITY_ADMIN_TEST_A_EMAIL','COMMUNITY_ADMIN_TEST_A_PASSWORD','COMMUNITY_ADMIN_TEST_B_EMAIL','COMMUNITY_ADMIN_TEST_B_PASSWORD','COMMUNITY_ADMIN_TEST_COMMUNITY_ID','COMMUNITY_ADMIN_TEST_FORENSIC_KEY'];
for (const name of required) if (!process.env[name]) throw new Error(`MISSING_REQUIRED_SECRET:${name}`);

const url = process.env.VITE_SUPABASE_URL;
const bucket = 'tv49-profile-media';
const communityId = process.env.COMMUNITY_ADMIN_TEST_COMMUNITY_ID;
const forensic = createClient(url, process.env.COMMUNITY_ADMIN_TEST_FORENSIC_KEY, { auth: { persistSession: false } });
const makeClient = () => createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const assert = (ok, msg, extra) => { if (!ok) throw new Error(`${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}`); };

async function login(email, password) {
  const c = makeClient();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`AUTH_FAILED:${error.message}`);
  assert(data.user?.id, 'AUTH_USER_MISSING');
  return c;
}

async function exists(path, expected) {
  const { data, error } = await forensic.from('storage.objects').select('id,bucket_id,name').eq('bucket_id', bucket).eq('name', path).maybeSingle();
  if (error) throw new Error(`STORAGE_FORENSIC_QUERY_FAILED:${error.message}`);
  assert(Boolean(data) === expected, expected ? 'STORAGE_OBJECT_MISSING' : 'STORAGE_OBJECT_ORPHANED', { path, data });
}

async function lifecycle(admin, member, kind, runId) {
  const path = `communities/${communityId}/${kind}/acceptance-${runId}.bin`;
  const bytes1 = new Uint8Array([1,2,3,4]);
  const bytes2 = new Uint8Array([8,7,6,5]);

  const create = await admin.storage.from(bucket).upload(path, bytes1, { contentType: 'application/octet-stream' });
  if (create.error) throw new Error(`ADMIN_${kind}_INSERT_FAILED:${create.error.message}`);
  await exists(path, true);

  const deniedInsert = await member.storage.from(bucket).upload(path, bytes1, { contentType: 'application/octet-stream', upsert: true });
  assert(deniedInsert.error, `REGULAR_${kind}_INSERT_ALLOWED`);

  const update = await admin.storage.from(bucket).update(path, bytes2, { contentType: 'application/octet-stream', upsert: false });
  if (update.error) throw new Error(`ADMIN_${kind}_UPDATE_FAILED:${update.error.message}`);
  const deniedUpdate = await member.storage.from(bucket).update(path, bytes1, { contentType: 'application/octet-stream', upsert: false });
  assert(deniedUpdate.error, `REGULAR_${kind}_UPDATE_ALLOWED`);

  const download = await admin.storage.from(bucket).download(path);
  if (download.error) throw new Error(`ADMIN_${kind}_DOWNLOAD_FAILED:${download.error.message}`);
  const actual = new Uint8Array(await download.data.arrayBuffer());
  assert(actual.length === bytes2.length && actual.every((v,i) => v === bytes2[i]), `${kind}_REPLACEMENT_NOT_VISIBLE`);

  const deniedDelete = await member.storage.from(bucket).remove([path]);
  assert(deniedDelete.error, `REGULAR_${kind}_DELETE_ALLOWED`);
  await exists(path, true);

  const remove = await admin.storage.from(bucket).remove([path]);
  if (remove.error) throw new Error(`ADMIN_${kind}_DELETE_FAILED:${remove.error.message}`);
  await exists(path, false);
}

try {
  const [admin, member] = await Promise.all([
    login(process.env.COMMUNITY_ADMIN_TEST_A_EMAIL, process.env.COMMUNITY_ADMIN_TEST_A_PASSWORD),
    login(process.env.COMMUNITY_ADMIN_TEST_B_EMAIL, process.env.COMMUNITY_ADMIN_TEST_B_PASSWORD),
  ]);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  await lifecycle(admin, member, 'icon', runId);
  await lifecycle(admin, member, 'banner', runId);
  console.log(JSON.stringify({ ok: true, checks: ['admin icon insert/replace/delete','regular icon direct insert/update/delete denied','admin banner insert/replace/delete','regular banner direct insert/update/delete denied','storage.objects forensic absence after cleanup'], communityId, runId }, null, 2));
} catch (error) {
  console.error(String(error?.stack || error));
  process.exitCode = 1;
}
