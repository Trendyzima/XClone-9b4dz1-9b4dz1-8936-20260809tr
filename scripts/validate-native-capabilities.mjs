import { readFileSync } from 'node:fs';

const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const activity = readFileSync('android/app/src/main/java/com/xclone/app/MainActivity.java', 'utf8');
const messaging = readFileSync('android/app/src/main/java/com/xclone/app/TestagramFirebaseMessagingService.java', 'utf8');
const worker = readFileSync('public/sw.js', 'utf8');
const push = readFileSync('src/services/pushNotifications.ts', 'utf8');
const checks = [
  ['Android declares camera permission', manifest.includes('android.permission.CAMERA')],
  ['Android declares microphone permission', manifest.includes('android.permission.RECORD_AUDIO')],
  ['Android declares Android 13+ notification permission', manifest.includes('android.permission.POST_NOTIFICATIONS')],
  ['Android App Link is HTTPS and restricted to Testagram', manifest.includes('android:scheme="https" android:host="testagram.site"')],
  ['WebView media requests validate trusted Testagram origin', activity.includes('isTrustedTestagramUrl(request.getOrigin())')],
  ['WebView media requests allow only camera and microphone resources', activity.includes('unsupportedResource') && activity.includes('PermissionRequest.RESOURCE_VIDEO_CAPTURE') && activity.includes('PermissionRequest.RESOURCE_AUDIO_CAPTURE')],
  ['WebView permission results revalidate origin and clean stale requests', activity.includes('isTrustedTestagramUrl(pending.getOrigin())') && activity.includes('safeDeny(pendingMediaPermissionRequest)')],
  ['WebView permission callbacks are cleaned up on activity destruction', activity.includes('if (pendingMediaPermissionRequest != null)') && activity.includes('fileCallback.onReceiveValue(null)')],
  ['External navigation blocks unsafe URI schemes', activity.includes('safeExternalScheme') && activity.includes('"mailto".equalsIgnoreCase(scheme)') && activity.includes('"tel".equalsIgnoreCase(scheme)')],
  ['FCM notification delivery checks OS permission and notification enablement', messaging.includes('POST_NOTIFICATIONS') && messaging.includes('areNotificationsEnabled()')],
  ['Web push requires a secure context and permission grant', push.includes('window.isSecureContext') && push.includes("permission !== 'granted'")],
  ['Service-worker notification targets are restricted to same origin', worker.includes('candidate.origin !== self.location.origin') && worker.includes('safeNotificationUrl(event.notification.data?.action_url')],
  ['Unrelated push notifications are not collapsed into one fixed tag', !worker.includes("tag: data.notification_id || 'testagram-notification'")],
];
let failures = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failures += 1;
}
console.log(`Native capability contract: ${checks.length - failures}/${checks.length} passed`);
if (failures) process.exitCode = 1;
