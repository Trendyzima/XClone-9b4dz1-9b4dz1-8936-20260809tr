import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKeysRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "";
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const TEST_A_EMAIL = Deno.env.get("COMMUNITY_ADMIN_TEST_A_EMAIL") ?? "";
const TEST_A_PASSWORD = Deno.env.get("COMMUNITY_ADMIN_TEST_A_PASSWORD") ?? "";
const TEST_B_EMAIL = Deno.env.get("COMMUNITY_ADMIN_TEST_B_EMAIL") ?? "";
const TEST_B_PASSWORD = Deno.env.get("COMMUNITY_ADMIN_TEST_B_PASSWORD") ?? "";
const COMMUNITY_ID = Deno.env.get("COMMUNITY_ADMIN_TEST_COMMUNITY_ID") ?? "";
const EXPECTED_REPOSITORY = "Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr";
const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const OIDC_AUDIENCE = `${SUPABASE_URL}/functions/v1/community-admin-runtime`;
const githubJwks = createRemoteJWKSet(new URL(`${OIDC_ISSUER}/.well-known/jwks`));

const parseKeys = (raw: string, name: string) => {
  if (!raw) throw new Error(`MISSING_PLATFORM_SECRET:${name}`);
  const parsed = JSON.parse(raw) as Record<string, string>;
  const key = parsed.default;
  if (!key) throw new Error(`MISSING_PLATFORM_SECRET:${name}.default`);
  return key;
};

const publishableKey = parseKeys(publishableKeysRaw, "SUPABASE_PUBLISHABLE_KEYS");
const secretKey = parseKeys(secretKeysRaw, "SUPABASE_SECRET_KEYS");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const fail = (code: string, message: string, status = 500, extra: Record<string, unknown> = {}) =>
  json({ ok: false, code, message, ...extra }, status);

const assert = (ok: unknown, code: string, details?: unknown) => {
  if (!ok) throw Object.assign(new Error(code), { code, details });
};

const transient = (error: unknown) => /ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network|502|503|504|429|temporarily unavailable|socket hang up/i.test(String(error));

async function authorizeGitHub(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) throw new Error("OIDC_AUTH_REQUIRED");
  const token = auth.slice("Bearer ".length).trim();
  const { payload } = await jwtVerify(token, githubJwks, { issuer: OIDC_ISSUER, audience: OIDC_AUDIENCE });
  assert(payload.repository === EXPECTED_REPOSITORY, "OIDC_REPOSITORY_MISMATCH");
  assert(payload.ref === "refs/heads/main", "OIDC_REF_NOT_ALLOWED");
  assert(payload.event_name === "push" || payload.event_name === "workflow_dispatch", "OIDC_EVENT_NOT_ALLOWED");
  return { repository: payload.repository, ref: payload.ref, event: payload.event_name };
}

const makePublic = () => createClient(SUPABASE_URL, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const makeAdmin = () => createClient(SUPABASE_URL, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function login(email: string, password: string) {
  const client = makePublic();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`AUTH_FAILED:${error?.message ?? "user missing"}`);
  return { client, user: data.user };
}

async function membership(admin: ReturnType<typeof makeAdmin>, userId: string) {
  const { data, error } = await admin.from("community_members").select("community_id,user_id,role,status").eq("community_id", COMMUNITY_ID).eq("user_id", userId);
  if (error) throw new Error(`MEMBERSHIP_QUERY_FAILED:${error.message}`);
  return data ?? [];
}

async function freshTarget(admin: ReturnType<typeof makeAdmin>, excluded: string[]) {
  const { data: members, error: memberError } = await admin.from("community_members").select("user_id").eq("community_id", COMMUNITY_ID).limit(5000);
  if (memberError) throw new Error(`MEMBER_LIST_FAILED:${memberError.message}`);
  const blocked = new Set((members ?? []).map((row) => row.user_id));
  for (const id of excluded) blocked.add(id);
  const { data: profiles, error } = await admin.from("profiles").select("id").limit(5000);
  if (error) throw new Error(`PROFILE_LIST_FAILED:${error.message}`);
  const target = (profiles ?? []).find((row) => row.id && !blocked.has(row.id));
  assert(target?.id, "NO_NON_MEMBER_TARGET_AVAILABLE");
  return target.id as string;
}

async function cleanupAcceptanceMedia(admin: ReturnType<typeof makeAdmin>) {
  const bucket = "tv49-profile-media";
  for (const kind of ["icon", "banner"]) {
    const prefix = `communities/${COMMUNITY_ID}/${kind}`;
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) throw new Error(`MEDIA_CLEANUP_LIST_FAILED:${kind}:${error.message}`);
    const stale = (data ?? []).filter((item) => item.name.startsWith("acceptance-")).map((item) => `${prefix}/${item.name}`);
    if (stale.length) {
      const { error: removeError } = await admin.storage.from(bucket).remove(stale);
      if (removeError) throw new Error(`MEDIA_CLEANUP_FAILED:${kind}:${removeError.message}`);
    }
  }
}

async function objectExists(admin: ReturnType<typeof makeAdmin>, path: string, expected: boolean) {
  const { data, error } = await admin.from("storage.objects").select("id").eq("bucket_id", "tv49-profile-media").eq("name", path).maybeSingle();
  if (error) throw new Error(`STORAGE_FORENSIC_QUERY_FAILED:${error.message}`);
  assert(Boolean(data) === expected, expected ? "STORAGE_OBJECT_MISSING" : "STORAGE_OBJECT_ORPHANED", { path });
}

async function mediaLifecycle(adminClient: ReturnType<typeof makePublic>, memberClient: ReturnType<typeof makePublic>, admin: ReturnType<typeof makeAdmin>, kind: string, runId: string) {
  const bucket = "tv49-profile-media";
  const path = `communities/${COMMUNITY_ID}/${kind}/acceptance-${runId}.bin`;
  const first = new Uint8Array([1, 2, 3, 4]);
  const second = new Uint8Array([8, 7, 6, 5]);

  const create = await adminClient.storage.from(bucket).upload(path, first, { contentType: "application/octet-stream" });
  if (create.error) throw new Error(`ADMIN_${kind}_INSERT_FAILED:${create.error.message}`);
  await objectExists(admin, path, true);

  const deniedInsert = await memberClient.storage.from(bucket).upload(path, first, { contentType: "application/octet-stream", upsert: true });
  assert(Boolean(deniedInsert.error), `REGULAR_${kind}_INSERT_ALLOWED`);

  const update = await adminClient.storage.from(bucket).update(path, second, { contentType: "application/octet-stream", upsert: false });
  if (update.error) throw new Error(`ADMIN_${kind}_UPDATE_FAILED:${update.error.message}`);
  const deniedUpdate = await memberClient.storage.from(bucket).update(path, first, { contentType: "application/octet-stream", upsert: false });
  assert(Boolean(deniedUpdate.error), `REGULAR_${kind}_UPDATE_ALLOWED`);

  const download = await adminClient.storage.from(bucket).download(path);
  if (download.error || !download.data) throw new Error(`ADMIN_${kind}_DOWNLOAD_FAILED:${download.error?.message ?? "data missing"}`);
  const actual = new Uint8Array(await download.data.arrayBuffer());
  assert(actual.length === second.length && actual.every((value, index) => value === second[index]), `${kind}_REPLACEMENT_NOT_VISIBLE`);

  const deniedDelete = await memberClient.storage.from(bucket).remove([path]);
  assert(Boolean(deniedDelete.error), `REGULAR_${kind}_DELETE_ALLOWED`);
  await objectExists(admin, path, true);

  const remove = await adminClient.storage.from(bucket).remove([path]);
  if (remove.error) throw new Error(`ADMIN_${kind}_DELETE_FAILED:${remove.error.message}`);
  await objectExists(admin, path, false);
}

async function runOnce() {
  assert(TEST_A_EMAIL && TEST_A_PASSWORD && TEST_B_EMAIL && TEST_B_PASSWORD && COMMUNITY_ID, "MISSING_ACCEPTANCE_SECRET");
  const admin = makeAdmin();
  await cleanupAcceptanceMedia(admin);

  const [a, b] = await Promise.all([
    login(TEST_A_EMAIL, TEST_A_PASSWORD),
    login(TEST_B_EMAIL, TEST_B_PASSWORD),
  ]);
  assert(a.user.id !== b.user.id, "TEST_ACCOUNTS_MUST_BE_DISTINCT");
  assert((await membership(admin, a.user.id)).some((row) => row.status === "active" && ["owner", "admin"].includes(row.role)), "ADMIN_FIXTURE_ROLE_INVALID");
  assert((await membership(admin, b.user.id)).some((row) => row.status === "active"), "MEMBER_FIXTURE_MEMBERSHIP_INVALID");

  const targetId = await freshTarget(admin, [a.user.id, b.user.id]);
  let targetAdded = false;
  try {
    const denied = await b.client.rpc("add_community_members", { p_community_id: COMMUNITY_ID, p_user_ids: [targetId] });
    assert(Boolean(denied.error), "REGULAR_MEMBER_ADD_RPC_ALLOWED");
    assert((await membership(admin, targetId)).length === 0, "UNAUTHORIZED_RPC_CREATED_MEMBERSHIP");

    const added = await a.client.rpc("add_community_members", { p_community_id: COMMUNITY_ID, p_user_ids: [targetId] });
    if (added.error) throw new Error(`ADMIN_ADD_MEMBER_FAILED:${added.error.message}`);
    targetAdded = true;
    let rows = await membership(admin, targetId);
    assert(rows.length === 1 && rows[0].status === "active" && rows[0].role === "member", "ADMIN_MEMBER_STATE_INVALID", rows);

    const duplicate = await a.client.rpc("add_community_members", { p_community_id: COMMUNITY_ID, p_user_ids: [targetId] });
    if (duplicate.error) throw new Error(`DUPLICATE_ADD_FAILED:${duplicate.error.message}`);
    rows = await membership(admin, targetId);
    assert(rows.length === 1, "DUPLICATE_MEMBERSHIP_CREATED", rows);

    await mediaLifecycle(a.client, b.client, admin, "icon", crypto.randomUUID());
    await mediaLifecycle(a.client, b.client, admin, "banner", crypto.randomUUID());

    return {
      ok: true,
      checks: [
        "two authenticated accounts",
        "admin role boundary",
        "regular member RPC denied",
        "admin RPC allowed",
        "membership persisted",
        "duplicate add safe",
        "admin icon insert/replace/delete",
        "regular icon direct mutation denied",
        "admin banner insert/replace/delete",
        "regular banner direct mutation denied",
        "privileged storage forensic cleanup",
      ],
    };
  } finally {
    if (targetAdded) {
      const { error } = await admin.from("community_members").delete().eq("community_id", COMMUNITY_ID).eq("user_id", targetId);
      if (error) throw new Error(`TEST_MEMBER_CLEANUP_FAILED:${error.message}`);
    }
    await cleanupAcceptanceMedia(admin);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "POST required", 405);
  const started = performance.now();
  try {
    const oidc = await authorizeGitHub(req);
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await runOnce();
        return json({ ok: true, status: "passed", attempt, duration_ms: Math.round(performance.now() - started), caller: oidc, ...result });
      } catch (error) {
        lastError = error;
        if (!transient(error) || attempt === 3) break;
        await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
      }
    }
    const error = lastError instanceof Error ? lastError : new Error(String(lastError));
    return fail((error as Error & { code?: string }).code ?? "ACCEPTANCE_FAILED", error.message, 500, { status: "failed", duration_ms: Math.round(performance.now() - started) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.startsWith("OIDC_") ? message : "CONTROLLER_AUTH_FAILED";
    return fail(code, code === "CONTROLLER_AUTH_FAILED" ? "Acceptance controller authentication failed" : message, 401);
  }
});
