import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "npm:@aws-sdk/client-s3@3";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const ACCOUNT = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? Deno.env.get("R2_ACCOUNT_ID") ?? "";
const ACCESS = Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID") ?? Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
const SECRET = Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY") ?? Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
const BUCKET = Deno.env.get("CLOUDFLARE_R2_BUCKET") ?? Deno.env.get("R2_MEDIA_BUCKET") ?? "";
const PUBLIC_BASE = (Deno.env.get("R2_PUBLIC_BASE_URL") ?? "").replace(/\/$/, "");
const MAX = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const admin = SERVICE ? createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const r2 = ACCOUNT && ACCESS && SECRET && BUCKET ? new S3Client({ region: "auto", endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`, credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET } }) : null;

async function currentUser(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || !ANON) return null;
  const client = createClient(URL, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await client.auth.getUser(token);
  return data.user ?? null;
}
function ext(mime: string) { return mime === "image/jpeg" ? "jpg" : mime.split("/")[1] ?? "bin"; }

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!admin || !r2 || !PUBLIC_BASE) return json({ error: "Cloudflare R2 ad media is not configured" }, 503);
  try {
    const user = await currentUser(req);
    if (!user) return json({ error: "Authentication required" }, 401);
    const form = await req.formData();
    const campaignId = String(form.get("campaign_id") ?? "");
    const file = form.get("file");
    if (!campaignId || !(file instanceof File)) return json({ error: "campaign_id and image file are required" }, 400);
    if (!ALLOWED.has(file.type.toLowerCase())) return json({ error: "Unsupported image type" }, 415);
    if (file.size <= 0 || file.size > MAX) return json({ error: "Ad image must be 10MB or smaller" }, 413);

    const { data: campaign } = await admin.from("testagram_ad_campaigns").select("id,advertiser_id").eq("id", campaignId).maybeSingle();
    if (!campaign) return json({ error: "Campaign not found" }, 404);
    const { data: advertiser } = await admin.from("testagram_advertisers").select("id,owner_user_id").eq("id", campaign.advertiser_id).maybeSingle();
    if (!advertiser || advertiser.owner_user_id !== user.id) return json({ error: "Campaign not owned by user" }, 403);

    const key = `ads/${user.id}/${campaignId}/creative.${ext(file.type.toLowerCase())}`;
    await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: new Uint8Array(await file.arrayBuffer()), ContentType: file.type.toLowerCase(), ContentLength: file.size, Metadata: { ownerId: user.id, campaignId } }));
    const head = await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    if (Number(head.ContentLength ?? 0) !== file.size) return json({ error: "Cloudflare upload verification failed" }, 502);
    const deliveryUrl = `${PUBLIC_BASE}/${key}`;
    const { data: creative } = await admin.from("testagram_ad_creatives").select("id").eq("campaign_id", campaignId).eq("enabled", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!creative) return json({ error: "Campaign creative not found" }, 404);
    const { error } = await admin.from("testagram_ad_creatives").update({ asset_url: deliveryUrl }).eq("id", creative.id).eq("campaign_id", campaignId);
    if (error) throw error;
    return json({ ok: true, campaign_id: campaignId, creative_id: creative.id, asset_url: deliveryUrl, object_key: key, size_bytes: file.size, owner: "testagram" });
  } catch (error) {
    console.error("zenad-ad-asset-upload compatibility endpoint", error);
    return json({ error: "Ad asset upload failed" }, 500);
  }
});
