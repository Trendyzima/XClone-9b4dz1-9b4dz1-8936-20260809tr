package com.xclone.tv;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.http.SslError;

/** Standalone Android TV shell. Intentionally does not modify or reuse the mobile Activity. */
public final class TvActivity extends Activity {
    private static final String APP_URL = "https://testagram.site/?tg_shell=android-tv-20261009";
    private static final String TV_FOCUS_SCRIPT =
            "(function(){"
            + "document.documentElement.setAttribute('data-xclone-tv','true');"
            + "var css=':focus,:focus-visible{outline:3px solid #35d07f!important;outline-offset:4px!important}'"
            + "+'button,a,input,textarea,select,[role=button],[tabindex]:not([tabindex=\"-1\"]){-webkit-tap-highlight-color:transparent;scroll-margin:12vh}'"
            + "+'button:focus,input:focus,textarea:focus,select:focus,[role=button]:focus{box-shadow:0 0 0 2px rgba(53,208,127,.28)!important}';"
            + "function install(d){try{if(!d||!d.head||d.getElementById('xclone-tv-focus-style'))return;"
            + "var s=d.createElement('style');s.id='xclone-tv-focus-style';s.textContent=css;d.head.appendChild(s);"
            + "if(!d.__xcloneTvFocusScroll){d.__xcloneTvFocusScroll=true;d.addEventListener('focusin',function(e){"
            + "var el=e.target;if(!el||!el.getBoundingClientRect)return;var r=el.getBoundingClientRect();"
            + "if(r.top<0||r.bottom>d.documentElement.clientHeight||r.left<0||r.right>d.documentElement.clientWidth)"
            + "el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});},true);}"
            + "Array.prototype.forEach.call(d.querySelectorAll('iframe'),function(f){"
            + "f.addEventListener('load',function(){try{install(f.contentDocument);}catch(ignore){}});"
            + "try{install(f.contentDocument);}catch(ignore){}});}catch(ignore){}}"
            + "install(document);})();";
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        hideSystemBars();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        String userAgent = settings.getUserAgentString()
                .replace("; wv", "")
                .replace(" Version/4.0", "");
        settings.setUserAgentString(userAgent);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Never weaken TLS validation to make a stream or page load.
                handler.cancel();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                // Keep HTTPS navigation inside the TV shell so sign-in redirects and
                // external content do not depend on a separate browser being installed.
                // Non-HTTPS navigation is blocked; TLS errors are always cancelled above.
                return !"https".equalsIgnoreCase(scheme);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // TV-only focus and scroll affordances; no catalogue or playback behavior changes.
                view.evaluateJavascript(TV_FOCUS_SCRIPT, null);
            }
        });

        setContentView(webView);
        webView.requestFocus(View.FOCUS_FORWARD);
        webView.loadUrl(APP_URL);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        // Let Chromium handle D-pad focus and select/enter for web controls. The
        // Activity only reserves Back for browser history/closing the app.
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK
                && event.getAction() == KeyEvent.ACTION_UP) {
            if (webView != null && webView.canGoBack()) {
                webView.goBack();
                return true;
            }
            finish();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void hideSystemBars() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
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
