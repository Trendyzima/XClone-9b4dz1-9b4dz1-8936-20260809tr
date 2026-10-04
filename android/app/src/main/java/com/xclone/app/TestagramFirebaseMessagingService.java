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
        ensureNotificationChannel();

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

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
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

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Testagram notifications",
                NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Messages, mentions, follows, calls and other Testagram alerts.");
        manager.createNotificationChannel(channel);
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) return value;
        }
        return null;
    }
}
