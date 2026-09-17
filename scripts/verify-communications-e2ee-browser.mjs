import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const required = [
  'E2EE_TEST_A_EMAIL', 'E2EE_TEST_A_PASSWORD',
  'E2EE_TEST_B_EMAIL', 'E2EE_TEST_B_PASSWORD',
  'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
  'E2EE_TEST_FORENSIC_KEY',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`MISSING_REQUIRED_SECRET:${name}`);
}

const baseURL = process.env.E2EE_TEST_BASE_URL || 'http://127.0.0.1:4173';
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const forensicKey = process.env.E2EE_TEST_FORENSIC_KEY;
const forensic = createClient(supabaseUrl, forensicKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const marker = `E2EE_RUNTIME_SENTINEL_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const edited = `${marker}_EDITED`;
const startedAt = new Date().toISOString();
const evidence = { marker, startedAt, checks: {} };

function assert(ok, msg, extra) {
  if (!ok) throw new Error(`${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}`);
}
async function expectVisible(page, locator, name) {
  await locator.waitFor({ state: 'visible', timeout: 30000 }).catch((e) => {
    throw new Error(`UI_NOT_VISIBLE:${name}:${e.message}`);
  });
}
async function signIn(page, email, password) {
  await page.goto(`${baseURL}/auth`, { waitUntil: 'domcontentloaded' });
  const emailInput = page.getByPlaceholder('Email').first();
  const passwordInput = page.getByPlaceholder('Password').first();
  await expectVisible(page, emailInput, 'email');
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  await page.waitForURL(/\/$/, { timeout: 30000 });
  await page.goto(`${baseURL}/messages`, { waitUntil: 'networkidle' });
  assert(page.url().includes('/messages'), 'AUTH_NAVIGATION_FAILED');
}
async function profileForEmail(email) {
  const { data: users, error } = await forensic.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`FORENSIC_AUTH_LIST_FAILED:${error.message}`);
  const user = users.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
  assert(user, 'TEST_USER_NOT_FOUND', { email });
  const { data: profile, error: pe } = await forensic
    .from('profiles').select('id,username,display_name').eq('id', user.id).maybeSingle();
  if (pe) throw new Error(`FORENSIC_PROFILE_FAILED:${pe.message}`);
  assert(profile, 'PROFILE_NOT_FOUND', { email, id: user.id });
  assert(profile.username, 'TEST_USER_USERNAME_REQUIRED', { email, id: user.id });
  return { authId: user.id, ...profile };
}
async function recentRows(table, since) {
  const { data, error } = await forensic.from(table).select('*').gte('created_at', since).limit(1000);
  if (error) throw new Error(`FORENSIC_QUERY_FAILED:${table}:${error.message}`);
  return data || [];
}
async function assertNoPlaintext(table, rows) {
  const serialized = JSON.stringify(rows);
  assert(!serialized.includes(marker), `PLAINTEXT_LEAK:${table}`);
  assert(!serialized.includes(edited), `EDITED_PLAINTEXT_LEAK:${table}`);
}
async function inspectConversation(conversationId) {
  const result = {};
  const messageQ = await forensic.from('messages').select('*').eq('conversation_id', conversationId).limit(1000);
  if (messageQ.error) throw new Error(`FORENSIC_QUERY_FAILED:messages:${messageQ.error.message}`);
  result.messages = messageQ.data || [];
  const commQ = await forensic.from('communication_delivery_outbox').select('*').eq('conversation_id', conversationId).limit(1000);
  if (commQ.error) throw new Error(`FORENSIC_QUERY_FAILED:communication_delivery_outbox:${commQ.error.message}`);
  result.communication_delivery_outbox = commQ.data || [];
  result.notifications = await recentRows('notifications', startedAt);
  result.notification_delivery_outbox = await recentRows('notification_delivery_outbox', startedAt);
  for (const [table, rows] of Object.entries(result)) await assertNoPlaintext(table, rows);
  for (const row of result.messages) {
    assert(!(row.body && String(row.body).includes(marker)), 'MESSAGE_BODY_PLAINTEXT_LEAK', { id: row.id });
    if (!row.deleted_at) assert(typeof row.ciphertext === 'string' && row.ciphertext.length > 0, 'MESSAGE_NOT_ENCRYPTED', { id: row.id });
  }
  return result;
}
async function conversationIdFor(aId, bId) {
  const { data: aRows, error: ae } = await forensic.from('conversation_members').select('conversation_id').eq('user_id', aId).limit(500);
  if (ae) throw new Error(`FORENSIC_CONVERSATION_MEMBERS_A_FAILED:${ae.message}`);
  const { data: bRows, error: be } = await forensic.from('conversation_members').select('conversation_id').eq('user_id', bId).limit(500);
  if (be) throw new Error(`FORENSIC_CONVERSATION_MEMBERS_B_FAILED:${be.message}`);
  const bSet = new Set((bRows || []).map((r) => r.conversation_id));
  const ids = (aRows || []).map((r) => r.conversation_id).filter((id) => bSet.has(id));
  assert(ids.length > 0, 'NO_SHARED_CONVERSATION_FOUND');
  const { data, error } = await forensic.from('conversations').select('id,created_at').in('id', ids).order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(`FORENSIC_CONVERSATION_QUERY_FAILED:${error.message}`);
  assert(data?.[0]?.id, 'NO_CONVERSATION_CREATED');
  return data[0].id;
}
async function openDirect(page, username) {
  await page.goto(`${baseURL}/messages?to=${encodeURIComponent(username)}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}
async function messageBox(page) {
  const candidates = [page.getByPlaceholder(/message/i), page.locator('textarea').last(), page.locator('input[type="text"]').last()];
  for (const candidate of candidates) if (await candidate.count()) return candidate;
  throw new Error('MESSAGE_COMPOSER_NOT_FOUND');
}
async function sendMessage(page, text) {
  const box = await messageBox(page);
  await expectVisible(page, box, 'message-composer');
  await box.fill(text);
  const sendButton = page.getByRole('button', { name: /send/i }).last();
  await expectVisible(page, sendButton, 'send-button');
  await sendButton.click();
}
async function bodyContains(page, text) {
  return (await page.locator('body').innerText()).includes(text);
}

fs.mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const contextA = await browser.newContext({ permissions: ['camera', 'microphone'] });
const contextB = await browser.newContext({ permissions: ['camera', 'microphone'] });
const pageA = await contextA.newPage();
const pageB = await contextB.newPage();
const realtimeFrames = { A: [], B: [] };
for (const [page, label] of [[pageA, 'A'], [pageB, 'B']]) {
  page.on('websocket', (ws) => {
    ws.on('framesent', (data) => realtimeFrames[label].push({ direction: 'sent', data: typeof data === 'string' ? data : JSON.stringify(data) }));
    ws.on('framereceived', (data) => realtimeFrames[label].push({ direction: 'received', data: typeof data === 'string' ? data : JSON.stringify(data) }));
  });
  page.on('console', (msg) => { if (msg.type() === 'error') console.error(`[browser-${label}] ${msg.text()}`); });
  page.on('pageerror', (err) => console.error(`[browser-${label}-pageerror] ${err.message}`));
}

try {
  const [aProfile, bProfile] = await Promise.all([
    profileForEmail(process.env.E2EE_TEST_A_EMAIL),
    profileForEmail(process.env.E2EE_TEST_B_EMAIL),
  ]);
  assert(aProfile.authId !== bProfile.authId, 'TEST_ACCOUNTS_MUST_BE_DISTINCT');
  evidence.checks.distinctAuthenticatedAccounts = true;

  await Promise.all([
    signIn(pageA, process.env.E2EE_TEST_A_EMAIL, process.env.E2EE_TEST_A_PASSWORD),
    signIn(pageB, process.env.E2EE_TEST_B_EMAIL, process.env.E2EE_TEST_B_PASSWORD),
  ]);
  evidence.checks.browserAAuthenticated = true;
  evidence.checks.browserBAuthenticated = true;

  await openDirect(pageA, bProfile.username);
  await openDirect(pageB, aProfile.username);
  await pageA.waitForTimeout(1000);
  await pageB.waitForTimeout(1000);

  await sendMessage(pageA, marker);
  await pageA.waitForTimeout(1200);
  await pageB.waitForTimeout(2500);
  assert(await bodyContains(pageB, marker), 'B_DID_NOT_DECRYPT_SENTINEL');
  evidence.checks.twoAccountMessageDecrypt = true;
  assert(!JSON.stringify(realtimeFrames).includes(marker), 'PLAINTEXT_LEAK_IN_REALTIME_WEBSOCKET');
  evidence.checks.realtimeFramesContainNoSentinel = true;

  let forensicRows = await inspectConversation(await conversationIdFor(aProfile.authId, bProfile.authId));
  void forensicRows;
  evidence.checks.databaseSentinelAbsent = true;
  evidence.checks.notificationOutboxSentinelAbsent = true;
  evidence.checks.messageRowsEncrypted = true;

  const requests = [];
  pageA.on('request', (req) => requests.push(req));
  const beforeCount = requests.length;
  const marker2 = `${marker}_NETWORK`;
  await sendMessage(pageA, marker2);
  await pageA.waitForTimeout(1000);
  const suspicious = requests.slice(beforeCount).filter((r) => (r.postData() || '').includes(marker2));
  assert(suspicious.length === 0, 'PLAINTEXT_SENT_OVER_HTTP', { count: suspicious.length });
  assert(!JSON.stringify(realtimeFrames).includes(marker2), 'PLAINTEXT_LEAK_IN_REALTIME_WEBSOCKET_SECOND_SEND');
  evidence.checks.outboundHttpPlaintextAbsent = true;

  async function findAction(page, messageText, pattern) {
    const target = page.getByText(messageText, { exact: true }).last();
    await expectVisible(page, target, `message-${pattern}`);
    await target.hover();
    let node = target;
    for (let depth = 0; depth < 6; depth++) {
      const buttons = node.getByRole('button');
      const n = await buttons.count();
      for (let i = 0; i < n; i++) {
        const button = buttons.nth(i);
        const hay = `${await button.getAttribute('aria-label') || ''} ${await button.getAttribute('title') || ''} ${await button.innerText().catch(() => '')}`.toLowerCase();
        if (pattern.test(hay)) return button;
      }
      node = node.locator('..');
    }
    return null;
  }

  const editButton = await findAction(pageA, marker, /edit/);
  assert(editButton, 'EDIT_CONTROL_NOT_FOUND');
  await editButton.click();
  const candidates = pageA.locator('textarea, input[type="text"]');
  const candidateCount = await candidates.count();
  let editIndex = -1;
  for (let i = 0; i < candidateCount; i++) {
    if ((await candidates.nth(i).inputValue().catch(() => '')) === marker) { editIndex = i; break; }
  }
  assert(editIndex >= 0, 'EDIT_INPUT_NOT_FOUND');
  const editInput = candidates.nth(editIndex);
  await editInput.fill(edited);
  await editInput.press('Enter');
  await pageA.waitForTimeout(1200);
  await pageB.waitForTimeout(2500);
  assert(await bodyContains(pageB, edited), 'B_DID_NOT_DECRYPT_EDIT');
  evidence.checks.twoAccountEncryptedEdit = true;
  await inspectConversation(await conversationIdFor(aProfile.authId, bProfile.authId));
  evidence.checks.editedPlaintextAbsentServerSide = true;

  const deleteButton = await findAction(pageA, edited, /delete|remove/);
  assert(deleteButton, 'DELETE_CONTROL_NOT_FOUND');
  await deleteButton.click();
  const confirm = pageA.getByRole('button', { name: /delete|confirm|yes/i }).last();
  if (await confirm.count()) await confirm.click();
  await pageA.waitForTimeout(1000);
  await pageB.waitForTimeout(1800);
  assert(!(await pageB.locator('body').innerText()).includes(edited), 'B_STILL_SHOWS_DELETED_PLAINTEXT');
  evidence.checks.twoAccountDeleteTombstone = true;
  await inspectConversation(await conversationIdFor(aProfile.authId, bProfile.authId));
  evidence.checks.deletedPlaintextAbsentServerSide = true;

  const videoButtons = pageA.getByRole('button', { name: /video/i });
  assert(await videoButtons.count() > 0, 'LIVEKIT_VIDEO_BUTTON_NOT_FOUND');
  await videoButtons.last().click();
  await pageB.waitForTimeout(2500);
  const accept = pageB.getByRole('button', { name: /accept|answer|join/i }).last();
  if (await accept.count()) await accept.click();
  await pageA.waitForTimeout(3500);
  await pageB.waitForTimeout(3500);
  const hasMedia = async (page) => page.locator('video').evaluateAll((vs) => vs.some((v) => v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0));
  assert((await hasMedia(pageA)) || (await hasMedia(pageB)), 'LIVEKIT_MEDIA_NOT_EXCHANGED');
  evidence.checks.liveKitMediaExchanged = true;

  await contextA.setOffline(true);
  await pageA.waitForTimeout(2500);
  await contextA.setOffline(false);
  await pageA.waitForTimeout(6000);
  await pageB.waitForTimeout(3000);
  assert(!/Unable to connect call/i.test(await pageA.locator('body').innerText()), 'LIVEKIT_RECONNECT_FAILED');
  assert((await hasMedia(pageA)) || (await hasMedia(pageB)), 'LIVEKIT_MEDIA_DID_NOT_RECOVER_AFTER_RECONNECT');
  evidence.checks.liveKitReconnectMedia = true;

  console.log(JSON.stringify({ ok: true, evidence }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, evidence, error: String(error?.stack || error) }, null, 2));
  await pageA.screenshot({ path: 'artifacts/e2ee-runtime-A.png', fullPage: true }).catch(() => {});
  await pageB.screenshot({ path: 'artifacts/e2ee-runtime-B.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await contextA.close().catch(() => {});
  await contextB.close().catch(() => {});
  await browser.close().catch(() => {});
}
