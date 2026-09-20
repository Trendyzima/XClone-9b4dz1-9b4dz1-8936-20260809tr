import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? (() => {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) return "";
  try { const parsed = JSON.parse(raw); return typeof parsed === "string" ? parsed : Object.values(parsed ?? {})[0] ?? ""; } catch { return ""; }
})();
const domain = (Deno.env.get("FEDERATION_DOMAIN") || "testagram.site").replace(/^https?:\/\//, "").replace(/\/$/, "");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
function pem(label: string, data: ArrayBuffer): string {
  const b64 = bytesToBase64(new Uint8Array(data));
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

async function createRsaPair() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("spki", pair.publicKey);
  const privateKey = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return {
    publicKeyPem: pem("PUBLIC KEY", publicKey),
    privateKeyPem: pem("PRIVATE KEY", privateKey),
  };
}

function isAdmin(user: any): boolean {
  const role = user?.app_metadata?.role ?? user?.app_metadata?.roles?.[0];
  return role === "admin" || role === "super_admin" || role === "owner";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!supabaseUrl || !publishableKey || !secretKey) return json({ error: "Server key configuration is incomplete" }, 500);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Authentication required" }, 401);
  const user = authData.user;

  let body: any = {};
  try { body = await req.json(); } catch {}

  const admin = isAdmin(user);
  const generateAll = body?.generate_all_missing === true;
  if (generateAll && !admin) return json({ error: "Admin access required for backfill" }, 403);

  const adminClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  async function generateForUser(userId: string) {
    const { data: profile } = await adminClient.from("profiles").select("username,display_name").eq("id", userId).maybeSingle();
    const username = String(profile?.username || `user-${userId.slice(0, 8)}`).toLowerCase().replace(/[^a-z0-9_\-]/g, "-").slice(0, 64);
    const actorId = `https://${domain}/users/${encodeURIComponent(username)}`;
    const inboxUrl = `${actorId}/inbox`;
    const outboxUrl = `${actorId}/outbox`;
    const followersUrl = `${actorId}/followers`;
    const followingUrl = `${actorId}/following`;

    const { data: existingKey } = await adminClient.from("activitypub_keys").select("id,key_id,public_key_pem").eq("user_id", userId).maybeSingle();
    if (existingKey) {
      const { data: existingActor } = await adminClient.from("activitypub_actors").select("*").eq("user_id", userId).maybeSingle();
      if (!existingActor) {
        const { data: actor, error: actorError } = await adminClient.from("activitypub_actors").insert({
          user_id: userId, actor_id: actorId, username, domain, inbox_url: inboxUrl, outbox_url: outboxUrl,
          followers_url: followersUrl, following_url: followingUrl, public_key_pem: existingKey.public_key_pem,
        }).select("id").single();
        if (actorError) throw actorError;
        await adminClient.from("activitypub_keys").update({ actor_id: actor.id }).eq("id", existingKey.id);
      } else if (existingActor.public_key_pem !== existingKey.public_key_pem || existingActor.actor_id !== actorId) {
        await adminClient.from("activitypub_actors").update({
          actor_id: actorId, username, domain, inbox_url: inboxUrl, outbox_url: outboxUrl,
          followers_url: followersUrl, following_url: followingUrl, public_key_pem: existingKey.public_key_pem, updated_at: new Date().toISOString(),
        }).eq("id", existingActor.id);
        await adminClient.from("activitypub_keys").update({ actor_id: existingActor.id }).eq("id", existingKey.id);
      }
      return { status: "exists", userId };
    }

    const pair = await createRsaPair();
    const keyId = `${actorId}#main-key`;
    const { data: actor, error: actorError } = await adminClient.from("activitypub_actors").upsert({
      user_id: userId, actor_id: actorId, username, domain, inbox_url: inboxUrl, outbox_url: outboxUrl,
      followers_url: followersUrl, following_url: followingUrl, public_key_pem: pair.publicKeyPem, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" }).select("id").single();
    if (actorError) throw actorError;

    const { error: keyError } = await adminClient.from("activitypub_keys").upsert({
      user_id: userId, actor_id: actor.id, key_id: keyId, public_key_pem: pair.publicKeyPem,
      private_key_pem: pair.privateKeyPem, algorithm: "RSASSA-PKCS1-v1_5", key_size: 2048,
    }, { onConflict: "user_id" });
    if (keyError) throw keyError;
    return { status: "created", userId };
  }

  try {
    if (generateAll) {
      const { data: users, error: usersError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (usersError) throw usersError;
      let generated = 0, existing = 0, failed = 0;
      const failures: Array<{ user_id: string; error: string }> = [];
      for (const u of users.users) {
        try {
          const result = await generateForUser(u.id);
          if (result.status === "created") generated++; else existing++;
        } catch (e) {
          failed++;
          failures.push({ user_id: u.id, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return json({ status: "backfill_complete", generated, existing, failed, failures: failures.slice(0, 25) });
    }

    const requestedUserId = typeof body?.user_id === "string" ? body.user_id : user.id;
    if (requestedUserId !== user.id && !admin) return json({ error: "Forbidden" }, 403);
    const result = await generateForUser(requestedUserId);
    return json(result);
  } catch (e) {
    console.error("activitypub-keygen failed", e);
    return json({ error: e instanceof Error ? e.message : "Key generation failed" }, 500);
  }
});