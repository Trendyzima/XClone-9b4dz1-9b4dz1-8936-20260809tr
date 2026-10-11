import { readFileSync } from 'node:fs';

const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const activity = readFileSync('android/app/src/main/java/com/xclone/app/MainActivity.java', 'utf8');
const messaging = readFileSync('android/app/src/main/java/com/xclone/app/TestagramFirebaseMessagingService.java', 'utf8');
const worker = readFileSync('public/sw.js', 'utf8');
const push = readFileSync('src/services/pushNotifications.ts', 'utf8');
const messages = readFileSync('src/pages/MessagesPage.tsx', 'utf8');
const identity = readFileSync('src/pages/IdentityVerificationPage.tsx', 'utf8');
const notificationPreferences = readFileSync('src/pages/NotificationPreferencesPage.tsx', 'utf8');
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
  ['Voice notes select supported WebM or MP4 codecs and create a real File', messages.includes('audio/mp4') && messages.includes('new globalThis.File([blob]')],
  ['Voice note failure paths stop microphone tracks', messages.includes("stream?.getTracks().forEach(track => track.stop())")],
  ['Voice note unmount cleanup stops the recorder and microphone stream', messages.includes('mediaStreamRef.current?.getTracks().forEach(track => track.stop())') && messages.includes('recorder.onstop = null')],
  ['Identity liveness capture clears timers and stops media tracks', identity.includes('mediaStream.current?.getTracks().forEach(track => track.stop())') && identity.includes('captureTimeout.current !== null')],
  ['Android shell publishes OS notification permission to the web app', readFileSync('android/app/src/main/java/com/xclone/app/MainActivity.java', 'utf8').includes('testagram:native-notification-status')],
  ['Notification settings reflect native FCM status and keep the test action available', notificationPreferences.includes('native-granted') && notificationPreferences.includes('testagram:native-notification-status')],
];
let failures = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failures += 1;
}
console.log(`Native capability contract: ${checks.length - failures}/${checks.length} passed`);
if (failures) process.exitCode = 1;
