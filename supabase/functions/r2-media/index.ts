import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID") ?? "";
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
const R2_BUCKET = Deno.env.get("R2_MEDIA_BUCKET") ?? "";
const R2_PUBLIC_BASE_URL = (Deno.env.get("R2_PUBLIC_BASE_URL") ?? "").replace(/\/$/, "");
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
  "video/mp4", "video/webm", "video/quicktime", "video/x-matroska",
]);

const cors = { ...corsHeaders, "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

const configured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_ROLE && R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
const r2 = configured() ? new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
}) : null;
const admin = SERVICE_ROLE ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

function extension(name: string, mime: string) {
  const fromName = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1];
  if (fromName) return fromName;
  return mime.split("/")[1].replace("jpeg", "jpg").replace("quicktime", "mov");
}

async function authenticate(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await client.auth.getUser(token);
  return user ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!configured() || !r2 || !admin) return json({ error: "Cloudflare R2 media storage is not configured." }, 503);

  try {
    const user = await authenticate(req);
    if (!user) return json({ error: "Authentication required" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "init") {
      const name = String(body.name ?? "").trim();
      const mime = String(body.mime_type ?? "").trim().toLowerCase();
      const size = Number(body.size_bytes);
      const postId = body.post_id ? String(body.post_id) : null;
      if (!name || name.length > 255) return json({ error: "Invalid file name" }, 400);
      if (!ALLOWED.has(mime)) return json({ error: "Unsupported media type" }, 415);
      if (!Number.isInteger(size) || size <= 0 || size > MAX_BYTES) return json({ error: "Media must be 20 MiB or smaller" }, 413);
      const mediaType = mime.startsWith("image/") ? "image" : "video";
      const objectKey = `users/${user.id}/${crypto.randomUUID()}.${extension(name, mime)}`;
      const command = new PutObjectCommand({ Bucket: R2_BUCKET, Key: objectKey, ContentType: mime, ContentLength: size });
      const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 900 });
      const publicUrl = R2_PUBLIC_BASE_URL ? `${R2_PUBLIC_BASE_URL}/${objectKey}` : null;
      const { data, error } = await admin.from("media_assets").insert({
        user_id: user.id, post_id: postId, object_key: objectKey, bucket: R2_BUCKET,
        original_name: name, mime_type: mime, media_type: mediaType, size_bytes: size,
        status: "pending", public_url: publicUrl,
      }).select("id,object_key,status,public_url").single();
      if (error) return json({ error: "Unable to create media record" }, 500);
      return json({ media_id: data.id, object_key: data.object_key, upload_url: uploadUrl, public_url: data.public_url, expires_in: 900 });
    }

    if (action === "complete") {
      const mediaId = String(body.media_id ?? "");
      if (!mediaId) return json({ error: "media_id is required" }, 400);
      const { data: media, error: lookupError } = await admin.from("media_assets").select("id,object_key,bucket,size_bytes,mime_type,status,public_url").eq("id", mediaId).eq("user_id", user.id).single();
      if (lookupError || !media) return json({ error: "Media record not found" }, 404);
      if (media.status === "uploaded") return json(media);
      const head = await r2.send(new HeadObjectCommand({ Bucket: media.bucket, Key: media.object_key }));
      const actualSize = Number(head.ContentLength ?? 0);
      const actualType = String(head.ContentType ?? "").toLowerCase();
      if (actualSize <= 0 || actualSize > MAX_BYTES || actualSize !== Number(media.size_bytes) || actualType !== String(media.mime_type).toLowerCase()) {
        await r2.send(new DeleteObjectCommand({ Bucket: media.bucket, Key: media.object_key }));
        await admin.from("media_assets").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", media.id).eq("user_id", user.id);
        return json({ error: "Uploaded media failed size/type validation" }, 422);
      }
      const { data: updated, error } = await admin.from("media_assets").update({ status: "uploaded", etag: head.ETag ?? null, updated_at: new Date().toISOString() }).eq("id", media.id).eq("user_id", user.id).select("id,object_key,size_bytes,mime_type,media_type,status,public_url,etag").single();
      if (error) return json({ error: "Unable to finalize media record" }, 500);
      return json(updated);
    }

    if (action === "delete") {
      const mediaId = String(body.media_id ?? "");
      const { data: media } = await admin.from("media_assets").select("id,object_key,bucket").eq("id", mediaId).eq("user_id", user.id).single();
      if (!media) return json({ error: "Media record not found" }, 404);
      await r2.send(new DeleteObjectCommand({ Bucket: media.bucket, Key: media.object_key }));
      await admin.from("media_assets").update({ status: "deleted", updated_at: new Date().toISOString() }).eq("id", media.id).eq("user_id", user.id);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("r2-media error", error);
    return json({ error: "Media operation failed" }, 500);
  }
});
