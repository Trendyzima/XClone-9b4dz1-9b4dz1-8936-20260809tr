package com.xclone.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessaging;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

public final class MainActivity extends AppCompatActivity {
    private static final String APP_URL = "https://testagram.site/";
    private static final int FILE_PICKER = 4101;
    private static final int MEDIA_PERMISSIONS = 4102;
    private ValueCallback<Uri[]> fileCallback;
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        WebView web = webView;
        web.setFitsSystemWindows(true);
        setContentView(web);

        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setDatabaseEnabled(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(true);
        web.getSettings().setSupportZoom(false);
        web.getSettings().setBuiltInZoomControls(false);
        web.getSettings().setDisplayZoomControls(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(web.getSettings(), WebSettingsCompat.FORCE_DARK_OFF);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                publishPushTokenToWeb();
                handlePushIntent(getIntent());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if ("testagram.site".equalsIgnoreCase(host) || "www.testagram.site".equalsIgnoreCase(host)) {
                    return false;
                }
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                            && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.getResources());
                    } else {
                        request.deny();
                        ActivityCompat.requestPermissions(MainActivity.this,
                                new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO},
                                MEDIA_PERMISSIONS);
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, FILE_PICKER);
                } catch (Exception e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }
        });

        createNotificationChannel();
        requestNotificationPermission();
        web.loadUrl(APP_URL);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handlePushIntent(intent);
        Uri data = intent.getData();
        if (isTrustedTestagramUrl(data)) {
            if (webView != null) webView.loadUrl(data.toString());
        }
    }

    private void publishPushTokenToWeb() {
        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(this, token -> {
            getSharedPreferences(TestagramFirebaseMessagingService.PREFS, MODE_PRIVATE)
                    .edit()
                    .putString(TestagramFirebaseMessagingService.TOKEN_KEY, token)
                    .apply();

            try {
                String json = JSONObject.quote(token);
                String script =
                        "window.__TESTAGRAM_FCM_TOKEN__=" + json + ";" +
                        "window.dispatchEvent(new CustomEvent('testagram:fcm-token',{detail:{token:" + json + "}}));";
                if (webView != null) webView.evaluateJavascript(script, null);
            } catch (Exception ignored) {
                // Token delivery to the page is best-effort; it will retry on the next page load.
            }
        });
    }

    private void handlePushIntent(Intent intent) {
        if (intent == null || webView == null) return;

        String url = firstNonBlank(
                intent.getStringExtra(TestagramFirebaseMessagingService.EXTRA_PUSH_URL),
                intent.getStringExtra("url"),
                intent.getStringExtra("deep_link"),
                intent.getStringExtra("deepLink"),
                intent.getStringExtra("redirectUrl"),
                intent.getStringExtra("action_url")
        );

        Uri uri = url == null ? intent.getData() : Uri.parse(url);
        if (isTrustedTestagramUrl(uri)) {
            webView.loadUrl(uri.toString());
            intent.removeExtra(TestagramFirebaseMessagingService.EXTRA_PUSH_URL);
            intent.removeExtra("url");
            intent.removeExtra("deep_link");
            intent.removeExtra("deepLink");
            intent.removeExtra("redirectUrl");
            intent.removeExtra("action_url");
        }
    }

    private static boolean isTrustedTestagramUrl(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        String host = uri.getHost();
        return "https".equalsIgnoreCase(scheme)
                && ("testagram.site".equalsIgnoreCase(host) || "www.testagram.site".equalsIgnoreCase(host));
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) return value;
        }
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        android.app.NotificationManager manager = getSystemService(android.app.NotificationManager.class);
        if (manager == null) return;
        android.app.NotificationChannel channel = new android.app.NotificationChannel(
                TestagramFirebaseMessagingService.CHANNEL_ID,
                "Testagram notifications",
                android.app.NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Messages, mentions, follows, calls and other Testagram alerts.");
        manager.createNotificationChannel(channel);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    4103
            );
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_PICKER && fileCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(results);
            fileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
