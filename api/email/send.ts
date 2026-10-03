import type { IncomingMessage, ServerResponse } from 'node:http';

function json(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });

  const apiKey = String(process.env.RESEND_API_KEY || '');
  const serviceToken = String(process.env.EMAIL_SERVICE_TOKEN || '');
  const authorization = String(req.headers.authorization || '');
  if (!apiKey || !serviceToken) return json(res, 503, { ok: false, error: 'EMAIL_SERVICE_NOT_CONFIGURED' });
  if (authorization !== `Bearer ${serviceToken}`) return json(res, 401, { ok: false, error: 'UNAUTHORIZED' });

  const chunks: Buffer[] = [];
  for await (const chunk of req as any) chunks.push(Buffer.from(chunk));
  let body: any;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { ok: false, error: 'INVALID_JSON' }); }

  const to = Array.isArray(body?.to) ? body.to : [body?.to];
  if (!to.length || to.some((value: unknown) => typeof value !== 'string' || !value.includes('@'))) return json(res, 400, { ok: false, error: 'INVALID_RECIPIENT' });
  if (typeof body?.subject !== 'string' || !body.subject.trim()) return json(res, 400, { ok: false, error: 'INVALID_SUBJECT' });
  if (typeof body?.html !== 'string' && typeof body?.text !== 'string') return json(res, 400, { ok: false, error: 'EMAIL_BODY_REQUIRED' });

  const from = String(body?.from || process.env.RESEND_FROM || 'Testagram <noreply@testagram.site>');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject: body.subject.trim(), html: typeof body.html === 'string' ? body.html : undefined, text: typeof body.text === 'string' ? body.text : undefined }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return json(res, 502, { ok: false, error: 'RESEND_SEND_FAILED', provider: result });
  return json(res, 200, { ok: true, provider: result });
}
