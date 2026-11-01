import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  (() => {
    try {
      return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default ?? "";
    } catch {
      return "";
    }
  })();

const BUCKET = "federated-media";
const RETENTION_MS = 24 * 60 * 60 * 1000;
const PREFIXES_PER_RUN = 16;
const LIST_LIMIT = 1000;
const DELETE_LIMIT = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function getDb() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Federated media cleanup is not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  const token = request.headers.get("x-federation-worker-token") ?? "";
  if (token.length < 32) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const db = getDb();
    // Reuse the database-owned random scheduler token. The token is never
    // compared against a source-code value and cannot be used when DB is down.
    const verification = await db.rpc("verify_federation_worker_token", {
      candidate: token,
    });
    if (verification.error) {
      console.error("federated media cleanup token verification unavailable", verification.error.code);
      return json({ ok: false, error: "Cleanup authorization unavailable" }, 503);
    }
    if (verification.data !== true) return json({ ok: false, error: "Unauthorized" }, 401);

    const stateResult = await db
      .from("federated_media_cleanup_state")
      .select("next_prefix")
      .eq("singleton", true)
      .maybeSingle();
    if (stateResult.error || !stateResult.data) {
      console.error("federated media cleanup cursor unavailable", stateResult.error?.code ?? "missing");
      return json({ ok: false, error: "Cleanup cursor unavailable" }, 503);
    }

    const startPrefix = Number(stateResult.data.next_prefix);
    const cutoffMs = Date.now() - RETENTION_MS;
    const storage = db.storage.from(BUCKET);
    let nextPrefix = startPrefix;
    let prefixesScanned = 0;
    let objectsDeleted = 0;
    let cutoffReached = false;

    for (let offset = 0; offset < PREFIXES_PER_RUN; offset++) {
      const prefixNumber = (startPrefix + offset) % 256;
      const prefix = prefixNumber.toString(16).padStart(2, "0");
      const listed = await storage.list(prefix, {
        limit: LIST_LIMIT,
        offset: 0,
        sortBy: { column: "created_at", order: "asc" },
      });

      if (listed.error) {
        console.error("federated media list failed", { prefix, code: listed.error.name });
        nextPrefix = prefixNumber;
        await db.from("federated_media_cleanup_state")
          .update({ next_prefix: nextPrefix, updated_at: new Date().toISOString() })
          .eq("singleton", true);
        return json({ ok: false, error: "Storage listing failed", prefixes_scanned: prefixesScanned }, 503);
      }

      prefixesScanned++;
      const expired = (listed.data ?? [])
        .filter((item) => Boolean(item.id) && Boolean(item.name))
        .filter((item) => {
          const timestamp = Date.parse(item.created_at ?? item.updated_at ?? "");
          return Number.isFinite(timestamp) && timestamp < cutoffMs;
        })
        .map((item) => `${prefix}/${item.name}`);

      const remainingCapacity = DELETE_LIMIT - objectsDeleted;
      if (expired.length > 0 && remainingCapacity > 0) {
        const paths = expired.slice(0, remainingCapacity);
        const removed = await storage.remove(paths);
        if (removed.error) {
          console.error("federated media removal failed", { prefix, code: removed.error.name });
          nextPrefix = prefixNumber;
          await db.from("federated_media_cleanup_state")
            .update({ next_prefix: nextPrefix, updated_at: new Date().toISOString() })
            .eq("singleton", true);
          return json({
            ok: false,
            error: "Storage removal failed",
            prefixes_scanned: prefixesScanned,
            objects_deleted: objectsDeleted,
          }, 503);
        }
        objectsDeleted += paths.length;
      }

      // Stay on the current prefix when the batch cap is reached or this prefix
      // still has expired objects. The next invocation resumes oldest-first.
      if (objectsDeleted >= DELETE_LIMIT || expired.length >= remainingCapacity) {
        nextPrefix = prefixNumber;
        cutoffReached = true;
        break;
      }
      nextPrefix = (prefixNumber + 1) % 256;
    }

    const cursor = await db
      .from("federated_media_cleanup_state")
      .update({ next_prefix: nextPrefix, updated_at: new Date().toISOString() })
      .eq("singleton", true);
    if (cursor.error) {
      console.error("federated media cleanup cursor update failed", cursor.error.code);
      return json({
        ok: false,
        error: "Cleanup cursor update failed",
        prefixes_scanned: prefixesScanned,
        objects_deleted: objectsDeleted,
      }, 503);
    }

    return json({
      ok: true,
      retention_hours: 24,
      prefixes_scanned: prefixesScanned,
      objects_deleted: objectsDeleted,
      cutoff: new Date(cutoffMs).toISOString(),
      next_prefix: nextPrefix,
      backlog_may_remain: cutoffReached,
    });
  } catch (error) {
    console.error(
      "federated media cleanup failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ ok: false, error: "Cleanup failed" }, 503);
  }
});
