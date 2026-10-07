import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const secretKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
const publishableKey = publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
if (!secretKey || !publishableKey) throw new Error("Supabase keys are not configured");

const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const BUCKET = "identity-documents";
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg","image/png","image/webp"]);
const cors = {
  "Access-Control-Allow-Origin": "https://testagram.site",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function ext(type: string) { return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"; }
async function ensureBucket() {
  const { data } = await admin.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes: [...ALLOWED] });
  if (error && !/already exists/i.test(error.message)) throw error;
}
function clientForUser(token: string) {
  return createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: "Bearer " + token } } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\\s+/i, "").trim();
  if (!token) return response({ ok: false, error: "AUTH_REQUIRED" }, 401);

  const userClient = clientForUser(token);
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  const user = userData.user;
  if (userError || !user) return response({ ok: false, error: "AUTH_REQUIRED" }, 401);
  if (user.is_anonymous) return response({ ok: false, error: "PERMANENT_ACCOUNT_REQUIRED" }, 403);

  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const sourceIp = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "").split(",")[0].trim() || null;
  const userAgent = req.headers.get("user-agent") || null;
  const form = await req.formData();
  const nationalId = String(form.get("national_id") || "").trim();
  const front = form.get("front");
  const back = form.get("back");

  if (!(front instanceof File) || !(back instanceof File)) return response({ ok: false, error: "FRONT_AND_BACK_REQUIRED" }, 400);
  if (!/^\\d{6,12}$/.test(nationalId.replace(/\\D/g, ""))) return response({ ok: false, error: "INVALID_NATIONAL_ID" }, 400);
  for (const file of [front, back]) {
    if (!ALLOWED.has(file.type)) return response({ ok: false, error: "UNSUPPORTED_DOCUMENT_TYPE" }, 400);
    if (file.size <= 0 || file.size > MAX_BYTES) return response({ ok: false, error: "DOCUMENT_TOO_LARGE" }, 400);
  }

  const normalizedId = nationalId.replace(/\\D/g, "");
  const verificationId = crypto.randomUUID();
  const frontPath = user.id + "/" + verificationId + "/front." + ext(front.type);
  const backPath = user.id + "/" + verificationId + "/back." + ext(back.type);

  try {
    await ensureBucket();
    const frontUpload = await admin.storage.from(BUCKET).upload(frontPath, front, { contentType: front.type, cacheControl: "0", upsert: false });
    if (frontUpload.error) throw frontUpload.error;
    const backUpload = await admin.storage.from(BUCKET).upload(backPath, back, { contentType: back.type, cacheControl: "0", upsert: false });
    if (backUpload.error) {
      await admin.storage.from(BUCKET).remove([frontPath]);
      throw backUpload.error;
    }

    const { data, error } = await admin.rpc("create_identity_verification", {
      p_user_id: user.id, p_national_id: normalizedId, p_front_object_path: frontPath, p_back_object_path: backPath,
      p_request_id: requestId, p_source_ip: sourceIp, p_user_agent: userAgent,
    });
    if (error) {
      await admin.storage.from(BUCKET).remove([frontPath, backPath]);
      const duplicate = error.message.includes("IDENTITY_ALREADY_REGISTERED");
      return response({ ok: false, error: duplicate ? "IDENTITY_ALREADY_REGISTERED" : "VERIFICATION_SUBMISSION_FAILED" }, duplicate ? 409 : 400);
    }
    return response({ ...data, request_id: requestId });
  } catch (error) {
    await admin.storage.from(BUCKET).remove([frontPath, backPath]).catch(() => {});
    await admin.from("identity_verification_events").insert({
      user_id: user.id, event_type: "IDENTITY_SUBMISSION_ERROR", outcome: "failure",
      request_id: requestId, source_ip: sourceIp, user_agent: userAgent,
      metadata: { message: error instanceof Error ? error.message : String(error) },
    });
    return response({ ok: false, error: "VERIFICATION_SUBMISSION_FAILED" }, 500);
  }
});