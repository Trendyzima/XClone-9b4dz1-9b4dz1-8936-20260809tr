import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import generator, { detector } from "npm:megalodon@10.3.0";
import { assertSafeRemoteUrl } from "../_shared/activitypub-security.ts";

type Provider = "mastodon" | "pleroma" | "friendica" | "firefish" | "gotosocial" | "pixelfed" | "akkoma" | "hometown" | "iceshrimp";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-testagram-client",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPPORTED = new Set<Provider>([
  "mastodon", "pleroma", "friendica", "firefish", "gotosocial", "pixelfed", "akkoma", "hometown", "iceshrimp",
]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function authenticate(request: Request) {
  const header = request.headers.get("authorization") || "";
  if (!/^Bearer\s+/i.test(header)) throw new Error("AUTH_REQUIRED");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("AUTH_REQUIRED");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("AUTH_INVALID");
  return { user: data.user, token };
}

async function providerFor(instance: string): Promise<Provider> {
  assertSafeRemoteUrl(instance);
  const detected = String(await detector(instance)).toLowerCase() as Provider;
  if (!SUPPORTED.has(detected)) throw new Error(`Unsupported Fediverse provider: ${detected}`);
  return detected;
}

async function clientFor(instance: string, accessToken?: string) {
  const provider = await providerFor(instance);
  return { provider, client: generator(provider, instance, accessToken || undefined) };
}

function normalizeLimit(value: unknown, fallback = 20, max = 40) {
  const n = Number(value ?? fallback);
  return Math.min(Math.max(Number.isFinite(n) ? Math.floor(n) : fallback, 1), max);
}

function requireRemoteToken(value: unknown): string {
  const token = text(value);
  if (!token) throw new Error("REMOTE_ACCESS_TOKEN_REQUIRED");
  if (token.length > 4096) throw new Error("REMOTE_ACCESS_TOKEN_INVALID");
  return token;
}

async function dispatch(input: any) {
  const instance = text(input.instance).replace(/\/$/, "");
  if (!instance) throw new Error("INSTANCE_REQUIRED");

  switch (text(input.action)) {
    case "detect": {
      const provider = await providerFor(instance);
      return { instance, provider };
    }
    case "register_app": {
      const { provider, client } = await clientFor(instance);
      const redirectUri = text(input.redirectUri) || "https://www.testagram.site/fediverse/callback";
      const app = await client.registerApp("Testagram", {
        scopes: (text(input.scopes) || "read write follow").split(/\s+/),
        redirect_uris: redirectUri,
        website: "https://www.testagram.site",
      });
      return { provider, ...app };
    }
    case "instance": {
      const { provider, client } = await clientFor(instance);
      const response = await client.getInstance();
      return { provider, instance: response.data };
    }
    case "verify": {
      const token = requireRemoteToken(input.accessToken);
      const { provider, client } = await clientFor(instance, token);
      const response = await client.verifyAccountCredentials();
      return { provider, account: response.data };
    }
    case "account": {
      const token = text(input.accessToken);
      const { provider, client } = await clientFor(instance, token || undefined);
      const response = await client.getAccount(text(input.accountId));
      return { provider, account: response.data };
    }
    case "status": {
      const token = text(input.accessToken);
      const { provider, client } = await clientFor(instance, token || undefined);
      const response = await client.getStatus(text(input.statusId));
      return { provider, status: response.data };
    }
    case "public_timeline": {
      const token = text(input.accessToken);
      const { provider, client } = await clientFor(instance, token || undefined);
      const response = await client.getPublicTimeline({ limit: normalizeLimit(input.limit) });
      return { provider, statuses: response.data };
    }
    case "home_timeline": {
      const token = requireRemoteToken(input.accessToken);
      const { provider, client } = await clientFor(instance, token);
      const response = await client.getHomeTimeline({ limit: normalizeLimit(input.limit) });
      return { provider, statuses: response.data };
    }
    case "search": {
      const token = text(input.accessToken);
      const { provider, client } = await clientFor(instance, token || undefined);
      const response = await client.search(text(input.query), { type: input.type || "statuses", limit: normalizeLimit(input.limit) });
      return { provider, result: response.data };
    }
    case "post": {
      const token = requireRemoteToken(input.accessToken);
      const { provider, client } = await clientFor(instance, token);
      const status = text(input.status);
      if (!status || status.length > 5000) throw new Error("STATUS_INVALID");
      const response = await client.postStatus(status, {
        visibility: input.visibility,
        spoiler_text: text(input.spoilerText) || undefined,
        sensitive: Boolean(input.sensitive),
        in_reply_to_id: text(input.inReplyToId) || undefined,
      });
      return { provider, status: response.data };
    }
    case "favourite": {
      const token = requireRemoteToken(input.accessToken);
      const { provider, client } = await clientFor(instance, token);
      const response = await client.favouriteStatus(text(input.statusId));
      return { provider, status: response.data };
    }
    case "unfavourite": {
      const token = requireRemoteToken(input.accessToken);
      const { provider, client } = await clientFor(instance, token);
      const response = await client.unfavouriteStatus(text(input.statusId));
      return { provider, status: response.data };
    }
    case "reblog": {
      const token = requireRemoteToken(input.accessToken);
      const { provider, client } = await clientFor(instance, token);
      const response = await client.reblogStatus(text(input.statusId));
      return { provider, status: response.data };
    }
    case "unreblog": {
      const token = requireRemoteToken(input.accessToken);
      const { provider, client } = await clientFor(instance, token);
      const response = await client.unreblogStatus(text(input.statusId));
      return { provider, status: response.data };
    }
    case "follow": {
      const token = requireRemoteToken(input.accessToken);
      const { provider, client } = await clientFor(instance, token);
      const response = await client.followAccount(text(input.accountId));
      return { provider, relationship: response.data };
    }
    case "unfollow": {
      const token = requireRemoteToken(input.accessToken);
      const { provider, client } = await clientFor(instance, token);
      const response = await client.unfollowAccount(text(input.accountId));
      return { provider, relationship: response.data };
    }
    default:
      throw new Error("UNSUPPORTED_ACTION");
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "POST_REQUIRED" }, 405);

  try {
    const { user } = await authenticate(request);
    const input = await request.json();
    const result = await dispatch(input);
    return json({ ok: true, user_id: user.id, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MEGALODON_GATEWAY_FAILED";
    const status = message === "AUTH_REQUIRED" || message === "AUTH_INVALID" ? 401 : message === "UNSUPPORTED_ACTION" ? 400 : 502;
    console.error("[megalodon-gateway]", message);
    return json({ ok: false, error: message }, status);
  }
});
