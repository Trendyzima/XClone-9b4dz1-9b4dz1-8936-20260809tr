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
import android.webkit.WebResourceError;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;

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

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setGeolocationEnabled(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        WebView.setWebContentsDebuggingEnabled(false);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            WebSettingsCompat.setSafeBrowsingEnabled(settings, true);
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(web.getSettings(), WebSettingsCompat.FORCE_DARK_OFF);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Never bypass TLS errors in production.
                handler.cancel();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                publishPushTokenToWeb();
                handlePushIntent(getIntent());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean camera = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
                    boolean audio = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
                    boolean needsCamera = false;
                    boolean needsAudio = false;
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) needsCamera = !camera;
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) needsAudio = !audio;
                    }
                    if (!needsCamera && !needsAudio) {
                        request.grant(request.getResources());
                        return;
                    }
                    request.deny();
                    java.util.ArrayList<String> permissions = new java.util.ArrayList<>();
                    if (needsCamera) permissions.add(Manifest.permission.CAMERA);
                    if (needsAudio) permissions.add(Manifest.permission.RECORD_AUDIO);
                    ActivityCompat.requestPermissions(MainActivity.this,
                            permissions.toArray(new String[0]), MEDIA_PERMISSIONS);
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
        Uri launchUri = getIntent() == null ? null : getIntent().getData();
        if (isTrustedTestagramUrl(launchUri)) {
            web.loadUrl(launchUri.toString());
        } else {
            web.loadUrl(APP_URL);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        publishPushTokenToWeb();
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
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == MEDIA_PERMISSIONS && webView != null) {
            webView.reload();
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
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
