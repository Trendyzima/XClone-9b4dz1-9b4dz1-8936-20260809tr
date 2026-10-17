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
  const mailUrl = String(process.env.TESTAGRAM_MAIL_URL || 'https://mail.testagram.site').replace(/\/$/, '');
  const mailToken = String(process.env.TESTAGRAM_MAIL_TOKEN || '');
  const authorization = String(req.headers.authorization || '');
  if (!serviceToken || !mailUrl || !mailToken) return json(res, 503, { ok: false, error: 'EMAIL_SERVICE_NOT_CONFIGURED' });
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

  const payload = {
    from: String(body?.from || process.env.TESTAGRAM_MAIL_FROM || 'Testagram <noreply@testagram.site>'),
    to,
    cc: Array.isArray(body?.cc) ? body.cc : undefined,
    bcc: Array.isArray(body?.bcc) ? body.bcc : undefined,
    reply_to: Array.isArray(body?.reply_to) ? body.reply_to : undefined,
    subject: body.subject.trim(),
    html: typeof body.html === 'string' ? body.html : undefined,
    text: typeof body.text === 'string' ? body.text : undefined,
  };
  const suppliedKey = String(req.headers['idempotency-key'] || '');
  const idempotencyKey = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedKey)
    ? suppliedKey
    : createHash('sha256').update('testagram-api-email|' + JSON.stringify(payload)).digest('hex');

  let response: Response;
  try {
    response = await fetch(mailUrl + '/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + mailToken,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return json(res, 502, { ok: false, error: 'TESTAGRAM_MAIL_UNAVAILABLE' });
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) return json(res, response.status === 429 ? 429 : 502, { ok: false, error: 'TESTAGRAM_MAIL_REJECTED' });
  return json(res, 200, { ok: true, id: result?.data?.id ?? null });
}
