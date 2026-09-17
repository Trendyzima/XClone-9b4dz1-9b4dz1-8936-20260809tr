import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=0, must-revalidate" },
});

function parseLimit(value: string | null): number {
  const n = Number.parseInt(value || "20", 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : 20, 1), 50);
}

function parseCursor(value: string): { publishedAt: string; id?: string } | null {
  try {
    const decoded = decodeURIComponent(value);
    const separator = decoded.indexOf("|");
    const publishedAt = separator >= 0 ? decoded.slice(0, separator) : decoded;
    const id = separator >= 0 ? decoded.slice(separator + 1) : undefined;
    const date = new Date(publishedAt);
    if (Number.isNaN(date.getTime())) return null;
    return { publishedAt: date.toISOString(), id: id || undefined };
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET") return json({ error: "GET required" }, 405);

  try {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const before = url.searchParams.get("before");

    let query = admin
      .from("federated_objects")
      .select("id,uri,object_type,actor_uri,instance_id,url,content,summary,published_at,updated_at,sensitive,in_reply_to_uri,quote_uri,language_code,attachments,tags,like_count,announce_count,reply_count,quote_count,view_count,content_warning,raw_object")
      .is("deleted_at", null)
      .eq("tombstone", false)
      .in("object_type", ["Note", "Article", "Question", "Video", "Image"])
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (before) {
      const cursor = parseCursor(before);
      if (!cursor) return json({ error: "Invalid before cursor" }, 400);
      if (cursor.id) {
        query = query.or(`published_at.lt.${cursor.publishedAt},and(published_at.eq.${cursor.publishedAt},id.lt.${cursor.id})`);
      } else {
        // Backwards-compatible ISO timestamp cursor for older clients.
        query = query.lt("published_at", cursor.publishedAt);
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last?.published_at
      ? encodeURIComponent(`${last.published_at}|${last.id}`)
      : null;

    return json({ items, pagination: { limit, hasMore, nextCursor } });
  } catch (error) {
    console.error("[federated-feed]", error);
    return json({ error: error instanceof Error ? error.message : "Federated feed failed" }, 500);
  }
});
