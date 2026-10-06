package com.xclone.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

public final class TestagramFirebaseMessagingService extends FirebaseMessagingService {
    public static final String PREFS = "testagram_push";
    public static final String TOKEN_KEY = "fcm_token";
    public static final String CHANNEL_ID = "testagram_notifications";
    public static final String URGENT_CHANNEL_ID = "testagram_notifications_urgent";
    public static final String UPDATES_CHANNEL_ID = "testagram_notifications_updates";
    public static final String EXTRA_PUSH_URL = "testagram_push_url";
    private static final String DEFAULT_TITLE = "Testagram";

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putString(TOKEN_KEY, token)
                .apply();
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        // Notification payloads are rendered automatically by FCM while the app is
        // backgrounded. This handler covers foreground and data-only messages.
        String title = message.getNotification() != null
                ? message.getNotification().getTitle()
                : message.getData().get("title");
        String body = message.getNotification() != null
                ? message.getNotification().getBody()
                : message.getData().get("body");

        if (title == null || title.trim().isEmpty()) title = DEFAULT_TITLE;
        if (body == null || body.trim().isEmpty()) body = "You have a new notification.";

        showNotification(title, body, message.getData());
    }

    private void showNotification(String title, String body, Map<String, String> data) {
        String kind = firstNonBlank(data.get("type"), data.get("event_name"), "notification");
        String channelId = channelFor(kind);
        ensureNotificationChannels();

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        String url = firstNonBlank(
                data.get("url"),
                data.get("deep_link"),
                data.get("deepLink"),
                data.get("redirectUrl")
        );
        if (url != null) {
            intent.putExtra(EXTRA_PUSH_URL, url);
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                ThreadLocalRandom.current().nextInt(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(isUrgent(kind) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

        NotificationManagerCompat notificationManager = NotificationManagerCompat.from(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (!notificationManager.areNotificationsEnabled()) {
            return;
        }
        try {
            notificationManager.notify(
                    ThreadLocalRandom.current().nextInt(1, Integer.MAX_VALUE),
                    builder.build()
            );
        } catch (SecurityException ignored) {
            // Notification permission can change between the check and notify().
        }
    }

    private void ensureNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel normal = new NotificationChannel(CHANNEL_ID, "Testagram notifications", NotificationManager.IMPORTANCE_DEFAULT);
        normal.setDescription("Routine Testagram activity and social notifications.");
        NotificationChannel urgent = new NotificationChannel(URGENT_CHANNEL_ID, "Testagram important alerts", NotificationManager.IMPORTANCE_HIGH);
        urgent.setDescription("Wallet, security, messages and other time-sensitive Testagram alerts.");
        NotificationChannel updates = new NotificationChannel(UPDATES_CHANNEL_ID, "Testagram updates", NotificationManager.IMPORTANCE_DEFAULT);
        updates.setDescription("Product announcements, feature updates and Testagram news.");
        manager.createNotificationChannel(normal);
        manager.createNotificationChannel(urgent);
        manager.createNotificationChannel(updates);
    }

    private static boolean isUrgent(String kind) {
        String k = kind == null ? "" : kind.toLowerCase();
        return k.contains("security") || k.contains("blocked") || k.contains("fraud")
                || k.contains("payment") || k.contains("wallet") || k.contains("payout")
                || k.contains("mpesa") || k.contains("ride") || k.contains("order")
                || k.contains("message") || k.contains("call") || k.contains("mention");
    }

    private static String channelFor(String kind) {
        String k = kind == null ? "" : kind.toLowerCase();
        if (isUrgent(k)) return URGENT_CHANNEL_ID;
        if (k.contains("campaign") || k.contains("announcement") || k.contains("update")
                || k.contains("news") || k.contains("release")) return UPDATES_CHANNEL_ID;
        return CHANNEL_ID;
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) return value;
        }
        return null;
    }
}
