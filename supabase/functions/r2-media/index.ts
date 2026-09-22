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

const MAX_BYTES = 500 * 1024 * 1024;
const BLOCKED = new Set([
  "application/x-msdownload", "application/x-msdos-program", "application/x-dosexec",
]);
function isAllowedMime(mime: string) {
  const normalized = mime.trim().toLowerCase();
  return Boolean(normalized && normalized !== "application/octet-stream" ? normalized.includes("/") : true)
    && !BLOCKED.has(normalized);
}
const cors = { ...corsHeaders, "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});
const configured = () => Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_ROLE &&
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET
);
const r2 = configured() ? new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
}) : null;
const admin = SERVICE_ROLE ? createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;

function extension(name: string, mime: string) {
  return name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1]
    ?? mime.split("/")[1].replace("jpeg", "jpg").replace("quicktime", "mov");
}

async function authenticate(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user } } = await client.auth.getUser(token);
  return user ?? null;
}

async function ownedPost(postId: string, userId: string) {
  const { data: post } = await admin!.from("posts").select("id,author_id,user_id").eq("id", postId).maybeSingle();
  return Boolean(post && (post.author_id === userId || post.user_id === userId));
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
      if (!isAllowedMime(mime)) return json({ error: "Unsupported media type" }, 415);
      if (!Number.isInteger(size) || size <= 0 || size > MAX_BYTES) return json({ error: "Media must be 500 MiB or smaller" }, 413);
      if (postId && !(await ownedPost(postId, user.id))) return json({ error: "Post not found or not owned by user" }, 404);

      const mediaType = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file";
      const storageKey = `users/${user.id}/${crypto.randomUUID()}.${extension(name, mime)}`;
      const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({
        Bucket: R2_BUCKET, Key: storageKey, ContentType: mime, ContentLength: size,
      }), { expiresIn: 900 });
      const mediaUrl = R2_PUBLIC_BASE_URL ? `${R2_PUBLIC_BASE_URL}/${storageKey}` : null;
      const { data, error } = await admin.from("media_assets").insert({
        owner_id: user.id, post_id: postId, storage_key: storageKey, bucket: R2_BUCKET,
        original_name: name, mime_type: mime, media_type: mediaType, byte_size: size,
        status: "pending", media_url: mediaUrl,
      }).select("id,storage_key,status,media_url").single();
      if (error) return json({ error: "Unable to create media record" }, 500);
      return json({ media_id: data.id, object_key: data.storage_key, upload_url: uploadUrl, public_url: data.media_url, expires_in: 900 });
    }

    if (action === "complete") {
      const mediaId = String(body.media_id ?? "");
      if (!mediaId) return json({ error: "media_id is required" }, 400);
      const { data: media, error: lookupError } = await admin.from("media_assets")
        .select("id,storage_key,bucket,byte_size,mime_type,media_type,status,media_url,post_id")
        .eq("id", mediaId).eq("owner_id", user.id).single();
      if (lookupError || !media) return json({ error: "Media record not found" }, 404);
      if (media.status === "uploaded") return json({ ...media, object_key: media.storage_key, size_bytes: media.byte_size, public_url: media.media_url });

      const head = await r2.send(new HeadObjectCommand({ Bucket: media.bucket ?? R2_BUCKET, Key: media.storage_key }));
      const actualSize = Number(head.ContentLength ?? 0);
      const actualType = String(head.ContentType ?? "").toLowerCase();
      if (actualSize <= 0 || actualSize > MAX_BYTES || actualSize !== Number(media.byte_size) || actualType !== String(media.mime_type).toLowerCase()) {
        await r2.send(new DeleteObjectCommand({ Bucket: media.bucket ?? R2_BUCKET, Key: media.storage_key }));
        await admin.from("media_assets").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", media.id).eq("owner_id", user.id);
        return json({ error: "Uploaded media failed size/type validation" }, 422);
      }

      const { data: updated, error } = await admin.from("media_assets")
        .update({ status: "uploaded", etag: head.ETag ?? null, updated_at: new Date().toISOString() })
        .eq("id", media.id).eq("owner_id", user.id)
        .select("id,storage_key,post_id,byte_size,mime_type,media_type,status,media_url,etag")
        .single();
      if (error) return json({ error: "Unable to finalize media record" }, 500);
      return json({ ...updated, object_key: updated.storage_key, size_bytes: updated.byte_size, public_url: updated.media_url });
    }

    if (action === "attach") {
      const mediaId = String(body.media_id ?? "");
      const postId = String(body.post_id ?? "");
      if (!mediaId || !postId) return json({ error: "media_id and post_id are required" }, 400);
      if (!(await ownedPost(postId, user.id))) return json({ error: "Post not found or not owned by user" }, 404);
      const { data: media } = await admin.from("media_assets").select("id,status").eq("id", mediaId).eq("owner_id", user.id).single();
      if (!media) return json({ error: "Media record not found" }, 404);
      if (media.status !== "uploaded") return json({ error: "Media is not uploaded" }, 409);
      const { data: updated, error } = await admin.from("media_assets")
        .update({ post_id: postId, updated_at: new Date().toISOString() })
        .eq("id", mediaId).eq("owner_id", user.id)
        .select("id,storage_key,post_id,media_url,media_type,mime_type,byte_size,status,etag")
        .single();
      if (error) return json({ error: "Unable to attach media to post" }, 500);
      return json({ ...updated, object_key: updated.storage_key, public_url: updated.media_url, size_bytes: updated.byte_size });
    }

    if (action === "delete") {
      const mediaId = String(body.media_id ?? "");
      const { data: media } = await admin.from("media_assets").select("id,storage_key,bucket")
        .eq("id", mediaId).eq("owner_id", user.id).single();
      if (!media) return json({ error: "Media record not found" }, 404);
      await r2.send(new DeleteObjectCommand({ Bucket: media.bucket ?? R2_BUCKET, Key: media.storage_key }));
      await admin.from("media_assets").update({ status: "deleted", updated_at: new Date().toISOString() })
        .eq("id", media.id).eq("owner_id", user.id);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("r2-media error", error);
    return json({ error: "Media operation failed" }, 500);
  }
});
