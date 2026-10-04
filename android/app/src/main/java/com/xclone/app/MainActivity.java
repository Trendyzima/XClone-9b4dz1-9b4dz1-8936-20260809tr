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
import androidx.core.view.WindowCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessaging;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

public final class MainActivity extends AppCompatActivity {
    private static final String APP_URL = "https://www.testagram.site/";
    private static final int FILE_PICKER = 4101;
    private static final int MEDIA_PERMISSIONS = 4102;
    private static final int LOCATION_PERMISSION = 4104;
    private ValueCallback<Uri[]> fileCallback;
    private android.webkit.GeolocationPermissions.Callback geolocationCallback;
    private String geolocationOrigin;
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Modern edge-to-edge shell: let the WebView occupy the entire display,
        // including behind transparent system bars. Important interactive content
        // remains responsible for its own safe-area/inset handling.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowCompat.enableEdgeToEdge(getWindow());
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightStatusBars(false);
        WindowInsetsControllerCompat initialController =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        initialController.setAppearanceLightNavigationBars(false);
        initialController.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
        enterImmersiveFullscreen();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().setNavigationBarDividerColor(android.graphics.Color.TRANSPARENT);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        }

        webView = new WebView(this);
        WebView web = webView;
        web.setFitsSystemWindows(false);
        // Keep the WebView physically edge-to-edge and let Chromium receive the
        // real system-bar/cutout insets so the website can use CSS safe-area-*.
        // Do not add native padding here: that would create the visible top/bottom
        // bands we are explicitly eliminating.
        ViewCompat.setOnApplyWindowInsetsListener(web, (view, insets) -> insets);
        ViewCompat.requestApplyInsets(web);
        web.setLayoutParams(new android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        // Never zoom-to-fit the desktop page; the responsive site owns the layout.
        settings.setLoadWithOverviewMode(false);
        // Honor Testagram's responsive viewport meta exactly as Chrome mobile does.
        settings.setUseWideViewPort(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Present the canonical site as a normal mobile Chrome browser rather than an
        // Android WebView. Some production web stacks suppress/alter rendering when the
        // WebView-only "wv" marker is present, which can make the homepage appear blank.
        // Keep the real Chromium/WebView version and Android device information intact;
        // only remove WebView-specific identification so the canonical web app follows
        // the same browser rendering path as testagram.site in Chrome.
        String mobileChromeUserAgent = settings.getUserAgentString()
                .replace("; wv", "")
                .replace(" Version/4.0", "");
        settings.setUserAgentString(mobileChromeUserAgent);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        WebView.setWebContentsDebuggingEnabled(false);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        web.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
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
                if (request.isForMainFrame()) {
                    android.util.Log.e("TestagramWebView", "Main-frame load error: " + request.getUrl()
                            + " code=" + error.getErrorCode() + " description=" + error.getDescription());
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, android.webkit.WebResourceResponse response) {
                super.onReceivedHttpError(view, request, response);
                if (request.isForMainFrame()) {
                    android.util.Log.e("TestagramWebView", "Main-frame HTTP error: " + request.getUrl()
                            + " status=" + response.getStatusCode());
                }
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                super.onPageCommitVisible(view, url);
                android.util.Log.d("TestagramWebView", "Page committed visibly: " + url);
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
            public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) {
                geolocationOrigin = origin;
                geolocationCallback = callback;
                boolean granted = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                        || ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                if (granted) { callback.invoke(origin, true, false); geolocationCallback = null; geolocationOrigin = null; }
                else ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_PERMISSION);
            }

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
        web.loadUrl(APP_URL);
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveFullscreen();
        publishPushTokenToWeb();
    }

    /**
     * Testagram is a true full-screen WebView shell: the website owns every pixel
     * from the physical top edge to the physical bottom edge. The Android status
     * and navigation bars must not reserve a black band around the WebView.
     *
     * Android can still reveal system bars transiently in response to an explicit
     * system gesture; this method restores immersive mode as soon as the Activity
     * regains focus.
     */
    private void enterImmersiveFullscreen() {
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller == null) return;

        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());

        // Compatibility fallback for older Android releases supported by this APK.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            getWindow().getDecorView().setSystemUiVisibility(
                    android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                            | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
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
        } else if (requestCode == LOCATION_PERMISSION && geolocationCallback != null) {
            boolean granted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            geolocationCallback.invoke(geolocationOrigin, granted, false);
            geolocationCallback = null; geolocationOrigin = null;
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
