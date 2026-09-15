const MAX_RESPONSE_BYTES = 1_500_000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 2;

function private4(ip: string) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a,b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function private6(ip: string) {
  const x = ip.toLowerCase().split('%')[0];
  if (x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff')) return true;
  const m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return !!m && private4(m[1]);
}
async function publicDns(host: string) {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('private federation hostname');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && private4(host)) throw new Error('private federation address');
  if (host.includes(':') && private6(host)) throw new Error('private federation address');
  const [a, aaaa] = await Promise.all([Deno.resolveDns(host, 'A').catch(() => [] as string[]), Deno.resolveDns(host, 'AAAA').catch(() => [] as string[])]);
  const ips = [...a, ...aaaa];
  if (!ips.length) throw new Error('federation DNS did not resolve');
  for (const ip of ips) if (ip.includes(':') ? private6(ip) : private4(ip)) throw new Error('federation DNS resolves to private address');
}
export async function assertFederationUrl(input: string) {
  const u = new URL(input);
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('federation URL must be HTTPS without credentials');
  await publicDns(u.hostname);
  return u;
}
async function limited(r: Response) {
  const length = Number(r.headers.get('content-length') || 0);
  if (length > MAX_RESPONSE_BYTES) throw new Error('federation response too large');
  const reader = r.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let total = 0;
  try { while (true) { const {done,value} = await reader.read(); if (done) break; if (value) { total += value.byteLength; if (total > MAX_RESPONSE_BYTES) throw new Error('federation response too large'); chunks.push(value); } } }
  finally { reader.releaseLock(); }
  const out = new Uint8Array(total); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; }
  return new TextDecoder().decode(out);
}
export async function federationFetch(input: string, init: RequestInit = {}, redirects = 0) {
  const u = await assertFederationUrl(input); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const h = new Headers(init.headers || {}); if (!h.has('Accept')) h.set('Accept','application/activity+json, application/ld+json;q=0.9, application/json;q=0.5');
    const r = await fetch(u, {...init, redirect:'manual', headers:h, signal:controller.signal});
    if (r.status >= 300 && r.status < 400) { if (redirects >= MAX_REDIRECTS) throw new Error('too many federation redirects'); const loc = r.headers.get('location'); if (!loc) throw new Error('federation redirect missing location'); return federationFetch(new URL(loc,u).toString(), init, redirects + 1); }
    return r;
  } catch (e) { if (e instanceof DOMException && e.name === 'AbortError') throw new Error('federation request timed out'); throw e; }
  finally { clearTimeout(timer); }
}
export async function federationJson(input: string, init: RequestInit = {}) {
  const r = await federationFetch(input, init); if (!r.ok) throw new Error(`federation fetch failed: ${r.status}`);
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (ct && !ct.includes('activity+json') && !ct.includes('ld+json') && !ct.includes('application/json') && !ct.includes('jrd+json')) throw new Error('unexpected federation content type');
  const raw = await limited(r); try { return JSON.parse(raw); } catch { throw new Error('invalid federation JSON'); }
}
export function actorKeyMatches(actor: any, actorUri: string) {
  const key = actor?.publicKey;
  return ['Person','Service','Organization','Group','Application'].includes(actor?.type) && actor?.id === actorUri && typeof key?.publicKeyPem === 'string' && key.publicKeyPem.includes('BEGIN PUBLIC KEY') && (!key.id || key.id.startsWith(actorUri + '#'));
}
export const federationJsonHeaders = {'Accept':'application/activity+json, application/ld+json;q=0.9, application/json;q=0.5'};
