import { createHmac, timingSafeEqual } from 'node:crypto';

export const config = { runtime: 'nodejs', api: { bodyParser: false } };

const MAX_HOOK_SKEW_SECONDS = 300;
const SMS_COOLDOWN_SECONDS = 60;
const SMS_HOURLY_LIMIT = 5;

function env(name: string) {
  return process.env[name] ?? '';
}

function json(res: any, status: number, body: unknown) {
  return res.status(status).json(body);
}

function timingSafeHexEqual(a: string, b: string) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyWebhook(body: string, req: any) {
  const configuredSecrets = env('SEND_SMS_HOOK_SECRETS') || env('SEND_SMS_HOOK_SECRET');
  const secrets = configuredSecrets.split('|').map((value) => value.trim()).filter(Boolean);
  const webhookId = String(req.headers['webhook-id'] ?? '');
  const timestamp = String(req.headers['webhook-timestamp'] ?? '');
  const signatures = String(req.headers['webhook-signature'] ?? '')
    .split(/\s+/).filter(Boolean);

  if (secrets.length === 0 || !webhookId || !timestamp || signatures.length === 0) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > MAX_HOOK_SKEW_SECONDS) return false;

  const signed = webhookId + '.' + timestamp + '.' + body;
  return secrets.some((secret) => {
    const rawSecret = secret.replace(/^v1,whsec_/, '');
    let key: Buffer;
    try { key = Buffer.from(rawSecret, 'base64'); } catch { return false; }
    const expected = createHmac('sha256', key).update(signed).digest('base64');

    return signatures.some((entry) => {
      const value = entry.replace(/^v1,/, '');
      const left = Buffer.from(value);
      const right = Buffer.from(expected);
      return left.length === right.length && timingSafeEqual(left, right);
    });
  });
}

function configValues() {
  return {
    supabaseUrl: env('SUPABASE_URL') || env('VITE_SUPABASE_URL'),
    serviceRole: env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY'),
    gatewayUrl: env('SMS_GATEWAY_URL'),
    gatewayKey: env('SMS_GATEWAY_API_KEY'),
    gatewayUsername: env('SMS_GATEWAY_USERNAME'),
    sender: env('SMS_SENDER_NAME') || 'Testagram',
    rateSecret: env('SMS_RATE_LIMIT_SECRET'),
  };
}

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('254') ? '+' + digits : phone.trim();
}

function hashPhone(phone: string, secret: string) {
  return createHmac('sha256', secret).update(normalizePhone(phone)).digest('hex');
}

async function consumeRateLimit(cfg: ReturnType<typeof configValues>, phoneHash: string) {
  if (!cfg.supabaseUrl || !cfg.serviceRole) return { allowed: false, status: 503, retryAfter: 60 };
  const response = await fetch(cfg.supabaseUrl + '/rest/v1/rpc/consume_sms_rate_limit', {
    method: 'POST',
    headers: {
      apikey: cfg.serviceRole,
      Authorization: 'Bearer ' + cfg.serviceRole,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_phone_hash: phoneHash,
      p_cooldown_seconds: SMS_COOLDOWN_SECONDS,
      p_hourly_limit: SMS_HOURLY_LIMIT,
    }),
  });
  if (!response.ok) return { allowed: false, status: 503, retryAfter: 60 };
  return await response.json();
}

async function sendToGateway(cfg: ReturnType<typeof configValues>, phone: string, otp: string) {
  if (!cfg.gatewayUrl || !cfg.gatewayKey || !cfg.gatewayUsername) {
    throw new Error('SMS gateway is not configured');
  }

  const form = new URLSearchParams({
    username: cfg.gatewayUsername,
    to: normalizePhone(phone),
    message: 'Your Testagram verification code is ' + otp + '. It expires soon. Do not share this code.',
  });
  if (cfg.sender) form.set('from', cfg.sender);

  const response = await fetch(cfg.gatewayUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      apiKey: cfg.gatewayKey,
    },
    body: form.toString(),
  });

  const responseText = await response.text().catch(() => '');
  let payload: any = null;
  try { payload = responseText ? JSON.parse(responseText) : null; } catch { /* provider may return non-JSON */ }

  if (!response.ok) {
    throw new Error('SMS gateway rejected message (' + response.status + ')');
  }

  const recipient = payload?.SMSMessageData?.Recipients?.[0];
  if (recipient && recipient.status !== 'Success') {
    throw new Error('SMS gateway reported delivery failure');
  }
}

async function rawBody(req: any): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const body = await rawBody(req);
  if (!verifyWebhook(body, req)) return json(res, 401, { error: 'Invalid webhook signature' });

  let event: any;
  try { event = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

  const phone = String(event?.user?.phone ?? '').trim();
  const otp = String(event?.sms?.otp ?? '').trim();
  if (!/^\+?[1-9]\d{7,14}$/.test(phone) || !/^\d{6}$/.test(otp)) {
    return json(res, 400, { error: 'Invalid SMS hook payload' });
  }

  const cfg = configValues();
  if (!cfg.rateSecret) return json(res, 503, { error: 'SMS rate-limit secret is not configured' });

  try {
    const limit = await consumeRateLimit(cfg, hashPhone(phone, cfg.rateSecret));
    if (!limit?.allowed) {
      res.setHeader('Retry-After', String(limit?.retryAfter ?? 60));
      return json(res, 429, { error: 'SMS rate limit exceeded' });
    }

    await sendToGateway(cfg, phone, otp);
    return json(res, 200, {});
  } catch (error) {
    console.error('send-sms hook failed', error instanceof Error ? error.message : 'unknown error');
    return json(res, 502, { error: 'SMS delivery failed' });
  }
}
