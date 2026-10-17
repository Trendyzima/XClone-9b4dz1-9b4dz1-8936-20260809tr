import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';

const MAX_BODY_BYTES = 1_048_576;

function json(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });

  const serviceToken = String(process.env.EMAIL_SERVICE_TOKEN || '');
  const supabaseUrl = String(process.env.SUPABASE_URL || 'https://ffrhglgkukgsuhxenena.supabase.co').replace(/\/$/, '');
  const serviceKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  const authorization = String(req.headers.authorization || '');
  if (!serviceToken || !supabaseUrl || !serviceKey) return json(res, 503, { ok: false, error: 'EMAIL_QUEUE_NOT_CONFIGURED' });
  if (authorization !== `Bearer ${serviceToken}`) return json(res, 401, { ok: false, error: 'UNAUTHORIZED' });

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as any) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > MAX_BODY_BYTES) return json(res, 413, { ok: false, error: 'PAYLOAD_TOO_LARGE' });
    chunks.push(value);
  }
  let body: any;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { ok: false, error: 'INVALID_JSON' }); }

  const to = Array.isArray(body?.to) ? body.to : [body?.to];
  if (!to.length || to.some((value: unknown) => typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return json(res, 400, { ok: false, error: 'INVALID_RECIPIENT' });
  if (typeof body?.subject !== 'string' || !body.subject.trim()) return json(res, 400, { ok: false, error: 'INVALID_SUBJECT' });
  if (typeof body?.html !== 'string' && typeof body?.text !== 'string') return json(res, 400, { ok: false, error: 'EMAIL_BODY_REQUIRED' });

  const normalize = (value: unknown): string[] => Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : typeof value === 'string' && value.trim() ? [value.trim()] : [];
  const payload = {
    from: String(body?.from || process.env.TESTAGRAM_MAIL_FROM || 'Testagram <noreply@testagram.site>'),
    to: normalize(body?.to),
    cc: normalize(body?.cc),
    bcc: normalize(body?.bcc),
    reply_to: normalize(body?.reply_to ?? body?.replyTo),
    subject: body.subject.trim(),
    html: typeof body.html === 'string' ? body.html : null,
    text: typeof body.text === 'string' ? body.text : null,
    headers: body?.headers && typeof body.headers === 'object' ? body.headers : {},
    scheduled_at: body?.scheduled_at ?? null,
  };
  const suppliedKey = String(req.headers['idempotency-key'] || '');
  const idempotencyKey = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedKey)
    ? suppliedKey
    : createHash('sha256').update('testagram-api-email|' + JSON.stringify(payload)).digest('hex');
  const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const endpoint = supabaseUrl + '/rest/v1/mail_messages';
  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
  const query = '?select=id,request_hash&idempotency_key=eq.' + encodeURIComponent(idempotencyKey);

  try {
    const existingResponse = await fetch(endpoint + query, { headers, cache: 'no-store', redirect: 'error' });
    if (!existingResponse.ok) return json(res, 502, { ok: false, error: 'EMAIL_QUEUE_UNAVAILABLE' });
    const existing = await existingResponse.json() as Array<{ id: string; request_hash: string | null }>;
    if (existing[0]) {
      if (existing[0].request_hash && existing[0].request_hash !== requestHash) {
        return json(res, 409, { ok: false, error: 'IDEMPOTENCY_KEY_REUSED' });
      }
      return json(res, 200, { ok: true, id: existing[0].id, queued: true });
    }

    const row = {
      from_address: payload.from, to_addresses: payload.to, cc_addresses: payload.cc,
      bcc_addresses: payload.bcc, reply_to_addresses: payload.reply_to,
      subject: payload.subject, html: payload.html, text: payload.text,
      headers: payload.headers, idempotency_key: idempotencyKey, request_hash: requestHash,
      status: payload.scheduled_at ? 'scheduled' : 'queued', scheduled_at: payload.scheduled_at,
    };
    const inserted = await fetch(endpoint + '?select=id', {
      method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(row), cache: 'no-store', redirect: 'error',
    });
    if (inserted.ok) {
      const rows = await inserted.json() as Array<{ id: string }>;
      if (rows[0]?.id) return json(res, 200, { ok: true, id: rows[0].id, queued: true });
    }
    if (inserted.status === 409) {
      const retry = await fetch(endpoint + query, { headers, cache: 'no-store', redirect: 'error' });
      const rows = retry.ok ? await retry.json() as Array<{ id: string; request_hash: string | null }> : [];
      if (rows[0]?.id && (!rows[0].request_hash || rows[0].request_hash === requestHash)) {
        return json(res, 200, { ok: true, id: rows[0].id, queued: true });
      }
      if (rows[0]?.id) return json(res, 409, { ok: false, error: 'IDEMPOTENCY_KEY_REUSED' });
    }
    return json(res, 502, { ok: false, error: 'EMAIL_QUEUE_REJECTED' });
  } catch {
    return json(res, 502, { ok: false, error: 'EMAIL_QUEUE_UNAVAILABLE' });
  }
}
