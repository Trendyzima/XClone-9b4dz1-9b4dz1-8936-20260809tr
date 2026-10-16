import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20261014120000_testagram_admin_ad_review_v1.sql', 'utf8');
const page = fs.readFileSync('mobile/lib/features/ads/ad_review_page.dart', 'utf8');
const policy = fs.readFileSync('mobile/lib/features/ads/ad_review_policy.dart', 'utf8');
const required = [
  ['campaign review is security definer', /function public\.testagram_admin_review_ad_campaign[\s\S]*?security definer/i],
  ['queue is permission checked', /function public\.testagram_admin_list_ad_review_queue[\s\S]*?testagram_has_permission\('platform\.ads'\)/i],
  ['review requires MFA privileged session', /function public\.testagram_admin_review_ad_campaign[\s\S]*?testagram_require_privileged_session\(\)/i],
  ['reject reason is mandatory server-side', /p_decision = 'rejected' and v_note is null then raise exception/i],
  ['paid-but-unreviewed campaigns stay pending review', /when moderation_status='pending' then 'pending_review'/i],
  ['impression claims require explicit moderation approval', /moderation_status='approved' and status='active' and payment_status='funded'/i],
  ['payment settlement returns actual activation state', /'activated',\(select status='active' from public\.testagram_ad_campaigns where id=p\.campaign_id\)/i],
  ['campaign owner receives an inbox result', /insert into public\.platform_inbox\(user_id, type, subject, body, icon_emoji, cta_label, cta_url, metadata\)/i],
  ['review is audited', /insert into public\.testagram_governance_audit_log\(actor_user_id, action, target_user_id, reason, metadata\)/i],
  ['Flutter page calls the secure review RPC', /\.rpc\(\s*['"]testagram_admin_review_ad_campaign['"]/i],
  ['Flutter UI does not allow repeat review', /status == 'pending'/i],
  ['reject reason length is bounded', /length <= 500/i],
];
const failures = required.filter(([, pattern]) => !pattern.test(`${migration}\n${page}\n${policy}`)).map(([label]) => label);
if (failures.length) {
  console.error(`Ad review contract failed: ${failures.join('; ')}`);
  process.exitCode = 1;
} else {
  console.log(`Ad review contract passed: ${required.length}/${required.length} checks.`);
}
