const DEFAULT_FROM = "Testagram <noreply@testagram.site>";

type MailPayload = {
  from?: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string | string[];
  subject: string;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, string>;
  scheduled_at?: string | null;
};

const list = (value: string | string[] | undefined): string[] =>
  Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean)
    : typeof value === "string" && value.trim() ? [value.trim()] : [];

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function headers(key: string) {
  return {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
  };
}

/**
 * Enqueue into Testagram's own PostgreSQL mail ledger. The existing local
 * /opt/testagram-mail worker polls this table and performs SMTP delivery.
 * This keeps auth independent of public mail DNS, reverse proxies and a second
 * HTTP gateway while retaining idempotency and durable retry semantics.
 */
export async function enqueueTestagramMail(input: MailPayload, idempotencyKey: string, config: { supabaseUrl?: string; serviceKey?: string } = {}): Promise<string> {
  const url = (config.supabaseUrl ?? Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const key = config.serviceKey
    ?? Deno.env.get("SUPABASE_SECRET_KEY")
    ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? "";
  if (!url || !key) throw new Error("TESTAGRAM_MAIL_QUEUE_NOT_CONFIGURED");
  if (!idempotencyKey || idempotencyKey.length > 200) throw new Error("INVALID_IDEMPOTENCY_KEY");

  const payload = {
    from: input.from?.trim() || DEFAULT_FROM,
    to: list(input.to),
    cc: list(input.cc),
    bcc: list(input.bcc),
    reply_to: list(input.reply_to),
    subject: input.subject.trim(),
    html: typeof input.html === "string" ? input.html : null,
    text: typeof input.text === "string" ? input.text : null,
    headers: input.headers ?? {},
    scheduled_at: input.scheduled_at ?? null,
  };
  if (!payload.to.length || !payload.subject || (payload.html === null && payload.text === null)) {
    throw new Error("INVALID_MAIL_PAYLOAD");
  }
  const requestHash = await sha256(JSON.stringify(payload));
  const endpoint = url + "/rest/v1/mail_messages";
  const query = "?select=id,request_hash,idempotency_key&idempotency_key=eq." + encodeURIComponent(idempotencyKey);

  const readExisting = async () => {
    const response = await fetch(endpoint + query, {
      headers: headers(key),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) throw new Error("TESTAGRAM_MAIL_QUEUE_READ_HTTP_" + response.status);
    const rows = await response.json();
    return Array.isArray(rows) ? rows[0] : undefined;
  };

  const existing = await readExisting();
  if (existing) {
    if (existing.request_hash && existing.request_hash !== requestHash) {
      throw new Error("TESTAGRAM_MAIL_IDEMPOTENCY_CONFLICT");
    }
    return String(existing.id);
  }

  const row = {
    from_address: payload.from,
    to_addresses: payload.to,
    cc_addresses: payload.cc,
    bcc_addresses: payload.bcc,
    reply_to_addresses: payload.reply_to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    headers: payload.headers,
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    status: payload.scheduled_at ? "scheduled" : "queued",
    scheduled_at: payload.scheduled_at,
  };
  const inserted = await fetch(endpoint + "?select=id,request_hash,idempotency_key", {
    method: "POST",
    headers: { ...headers(key), Prefer: "return=representation" },
    body: JSON.stringify(row),
    cache: "no-store",
    redirect: "error",
  });
  if (inserted.ok) {
    const rows = await inserted.json();
    if (Array.isArray(rows) && rows[0]?.id) return String(rows[0].id);
    const duplicate = await readExisting();
    if (duplicate?.id) {
      if (duplicate.request_hash && duplicate.request_hash !== requestHash) {
        throw new Error("TESTAGRAM_MAIL_IDEMPOTENCY_CONFLICT");
      }
      return String(duplicate.id);
    }
    throw new Error("TESTAGRAM_MAIL_QUEUE_INSERT_EMPTY");
  }

  // Concurrent retries may race on the unique idempotency key. Re-read the
  // winner rather than creating duplicate messages or treating it as delivery.
  if (inserted.status === 409) {
    const duplicate = await readExisting();
    if (duplicate?.id) {
      if (duplicate.request_hash && duplicate.request_hash !== requestHash) {
        throw new Error("TESTAGRAM_MAIL_IDEMPOTENCY_CONFLICT");
      }
      return String(duplicate.id);
    }
  }
  throw new Error("TESTAGRAM_MAIL_QUEUE_INSERT_HTTP_" + inserted.status);
}
