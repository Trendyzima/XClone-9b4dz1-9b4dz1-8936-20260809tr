import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = { ...corsHeaders, "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const MIN_BUDGET_KES = 500;
const ALLOWED_FORMATS = new Set(["display", "story", "video"]);

async function currentUser(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || !ANON) return null;
  const client = createClient(URL, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await client.auth.getUser(token);
  return data.user ?? null;
}

function safeUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "https://testagram.site";
  const url = new URL(raw);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("INVALID_CLICK_URL");
  return url.toString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!SERVICE || !ANON) return json({ error: "Ad service is not configured" }, 503);

  try {
    const user = await currentUser(req);
    if (!user?.id) return json({ error: "Authentication required" }, 401);
    const body = await req.json();
    const name = String(body.name ?? body.title ?? "").trim();
    const headline = String(body.headline ?? body.title ?? "").trim();
    const description = String(body.description ?? body.body ?? "").trim();
    const amount = Number(body.budget_kes);
    const format = String(body.format ?? "display").toLowerCase();
    if (!name || name.length > 120 || !headline || headline.length > 120) return json({ error: "Ad title is required and must be 120 characters or fewer" }, 400);
    if (!description || description.length > 500) return json({ error: "Ad description is required and must be 500 characters or fewer" }, 400);
    if (!Number.isFinite(amount) || amount < MIN_BUDGET_KES || amount > 150000) return json({ error: `Ad budget must be between KES ${MIN_BUDGET_KES.toLocaleString()} and KES 150,000` }, 400);
    if (!ALLOWED_FORMATS.has(format)) return json({ error: "Unsupported ad format" }, 400);
    const startAt = body.start_at ? new Date(String(body.start_at)) : new Date();
    const endAt = body.end_at ? new Date(String(body.end_at)) : new Date(Date.now() + 30 * 86400000);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) return json({ error: "Campaign end must be after start" }, 400);
    const targeting = body.targeting && typeof body.targeting === "object" ? body.targeting : {};
    const targetUrl = safeUrl(body.click_through_url);

    const { data: advertiserExisting, error: existingError } = await admin.from("testagram_advertisers").select("id,name,status").eq("owner_user_id", user.id).eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (existingError) throw existingError;
    let advertiser = advertiserExisting;
    if (!advertiser) {
      const { data, error } = await admin.from("testagram_advertisers").insert({ owner_user_id: user.id, name: String(body.advertiser_name ?? user.email?.split("@")[0] ?? "Testagram Advertiser").slice(0, 120), status: "active" }).select("id,name,status").single();
      if (error || !data) throw error ?? new Error("ADVERTISER_CREATE_FAILED");
      advertiser = data;
    }

    const { data: existingAccount, error: accountLookupError } = await admin.from("testagram_ad_accounts").select("id,name,status").eq("owner_user_id", user.id).eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (accountLookupError) throw accountLookupError;
    let adAccount = existingAccount;
    if (!adAccount) {
      const { data, error } = await admin.from("testagram_ad_accounts").insert({ owner_user_id: user.id, name: "Personal Ad Account", currency: "KES", status: "active", timezone: "Africa/Nairobi" }).select("id,name,status").single();
      if (error || !data) throw error ?? new Error("AD_ACCOUNT_CREATE_FAILED");
      adAccount = data;
      const { error: memberError } = await admin.from("testagram_ad_account_members").insert({ ad_account_id: adAccount.id, user_id: user.id, role: "owner" });
      if (memberError) throw memberError;
    }

    const budgetMicros = Math.round(amount * 1_000_000);
    const bidCpmMicros = Math.max(50000, Number(body.bid_cpm_micros ?? 50000));
    const { data: campaign, error: campaignError } = await admin.from("testagram_ad_campaigns").insert({ advertiser_id: advertiser.id, ad_account_id: adAccount.id, created_by: user.id, name, objective: String(body.objective ?? "traffic"), status: "draft", payment_status: "unpaid", currency: "KES", lifetime_budget_micros: budgetMicros, daily_budget_micros: body.daily_budget_kes == null ? null : Math.round(Number(body.daily_budget_kes) * 1_000_000), bid_cpm_micros: bidCpmMicros, priority: Math.max(0, Math.min(1000, Number(body.priority ?? 50))), starts_at: startAt.toISOString(), ends_at: endAt.toISOString(), targeting }).select("id,advertiser_id,ad_account_id,name,status,payment_status,currency,lifetime_budget_micros,starts_at,ends_at").single();
    if (campaignError || !campaign) throw campaignError ?? new Error("CAMPAIGN_CREATE_FAILED");

    const { data: adSet, error: adSetError } = await admin.from("testagram_ad_sets").insert({ campaign_id: campaign.id, name: `${name} Ad Set`, status: "active", optimization_goal: "traffic", billing_event: "impression", bid_strategy: "lowest_cost", bid_amount_minor: Math.max(1, Math.round(amount * 100)), lifetime_budget_minor: Math.round(amount * 100), start_at: startAt.toISOString(), end_at: endAt.toISOString(), placement_mode: "automatic" }).select("id,campaign_id,name,status").single();
    if (adSetError || !adSet) {
      await admin.from("testagram_ad_campaigns").delete().eq("id", campaign.id);
      throw adSetError ?? new Error("AD_SET_CREATE_FAILED");
    }

    const { data: creative, error: creativeError } = await admin.from("testagram_ad_creatives").insert({ campaign_id: campaign.id, format, headline, body: description, cta: String(body.cta ?? "Learn more").slice(0, 40), click_through_url: targetUrl, weight: 1, enabled: true }).select("id,campaign_id,format,headline,body,cta,asset_url,click_through_url").single();
    if (creativeError || !creative) {
      await admin.from("testagram_ad_sets").delete().eq("id", adSet.id);
      await admin.from("testagram_ad_campaigns").delete().eq("id", campaign.id);
      throw creativeError ?? new Error("CREATIVE_CREATE_FAILED");
    }

    const { data: ad, error: adError } = await admin.from("testagram_ads").insert({ ad_set_id: adSet.id, creative_id: creative.id, name, status: "active", destination_type: "url", destination_url: targetUrl, call_to_action: String(body.cta ?? "Learn more").slice(0, 40), tracking_params: {}, created_by: user.id }).select("id,ad_set_id,creative_id,name,status,destination_type,destination_url,call_to_action").single();
    if (adError || !ad) {
      await admin.from("testagram_ad_creatives").delete().eq("id", creative.id);
      await admin.from("testagram_ad_sets").delete().eq("id", adSet.id);
      await admin.from("testagram_ad_campaigns").delete().eq("id", campaign.id);
      throw adError ?? new Error("AD_CREATE_FAILED");
    }

    return json({ ok: true, owner: "testagram", campaign, ad_account: adAccount, ad_set: adSet, creative, ad });
  } catch (error) {
    console.error("testagram-ad-campaign", error);
    return json({ error: error instanceof Error ? error.message : "Ad campaign creation failed" }, 500);
  }
});
