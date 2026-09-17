import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "npm:@aws-sdk/client-s3@3";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const ACCOUNT_ID = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? Deno.env.get("R2_ACCOUNT_ID") ?? "";
const ACCESS_KEY = Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID") ?? Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
const SECRET_KEY = Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY") ?? Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
const BUCKET = Deno.env.get("CLOUDFLARE_R2_BUCKET") ?? Deno.env.get("R2_MEDIA_BUCKET") ?? "";
const PUBLIC_BASE = (Deno.env.get("R2_PUBLIC_BASE_URL") ?? "").replace(/\/$/, "");
const MAX_AVATAR = 2 * 1024 * 1024;
const MAX_COVER = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const cors = { ...corsHeaders, "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_ROLE && ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET && PUBLIC_BASE);
const r2 = configured ? new S3Client({ region: "auto", endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY } }) : null;
const admin = SERVICE_ROLE ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

async function authenticate(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await client.auth.getUser(token);
  return user ?? null;
}

function extension(mime: string) { return mime === "image/jpeg" ? "jpg" : mime.split("/")[1] || "bin"; }

async function detectImageMime(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.slice(0, 8).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i])) return "image/png";
  if (bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)) === "GIF87a") return "image/gif";
  if (bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)) === "GIF89a") return "image/gif";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp") {
    const brand = new TextDecoder().decode(bytes.slice(8, 12));
    if (["avif", "avis"].includes(brand)) return "image/avif";
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, 405);
  if (!configured || !r2 || !admin) return json({ error: "Cloudflare R2 media storage is not configured", code: "R2_NOT_CONFIGURED" }, 503);
  try {
    const user = await authenticate(req);
    if (!user) return json({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);
    const form = await req.formData();
    const kind = String(form.get("kind") ?? "");
    const file = form.get("file");
    if (kind !== "avatar" && kind !== "cover") return json({ error: "kind must be avatar or cover", code: "INVALID_KIND" }, 400);
    if (!(file instanceof File)) return json({ error: "Image file is required", code: "FILE_REQUIRED" }, 400);
    if (file.size <= 0) return json({ error: "Image file is empty", code: "EMPTY_FILE" }, 400);
    const max = kind === "avatar" ? MAX_AVATAR : MAX_COVER;
    if (file.size > max) return json({ error: `Profile ${kind} must be ${max / 1024 / 1024}MB or smaller`, code: "FILE_TOO_LARGE" }, 413);

    const declaredMime = file.type.toLowerCase();
    const detectedMime = await detectImageMime(file);
    const mime = ALLOWED.has(declaredMime) ? declaredMime : detectedMime;
    if (!mime || !ALLOWED.has(mime)) return json({ error: "Unsupported or invalid profile image type", code: "INVALID_IMAGE_TYPE" }, 415);
    if (detectedMime && detectedMime !== mime) return json({ error: "Profile image content does not match its declared type", code: "IMAGE_TYPE_MISMATCH" }, 415);

    const key = `profiles/${user.id}/${kind}.${extension(mime)}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes, ContentType: mime, ContentLength: file.size, Metadata: { ownerId: user.id, profileMedia: kind } }));
    const head = await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    if (Number(head.ContentLength ?? 0) !== file.size) return json({ error: "Cloudflare upload verification failed", code: "R2_SIZE_MISMATCH" }, 502);

    const deliveryUrl = `${PUBLIC_BASE}/${key}`;
    const field = kind === "avatar" ? "avatar_url" : "cover_url";
    const { error } = await admin.from("profiles").update({ [field]: deliveryUrl }).eq("id", user.id);
    if (error) return json({ error: "Image uploaded but profile update failed", code: "PROFILE_UPDATE_FAILED" }, 500);

    return json({ ok: true, kind, delivery_url: deliveryUrl, object_key: key, size_bytes: file.size, mime_type: mime, etag: head.ETag ?? null });
  } catch (error) {
    console.error("profile-media-upload error", error);
    return json({ error: "Profile media operation failed", code: "PROFILE_MEDIA_FAILED" }, 500);
  }
});
