package com.xclone.app;

import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private long lastBackPressed = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TestagramNativePlugin.class);
        super.onCreate(savedInstanceState);

        // ================= Immersive Fullscreen =================
        final View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY    // Keep immersive after swipe
            | View.SYSTEM_UI_FLAG_FULLSCREEN        // Hide status bar
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION   // Hide navigation bar
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        );
    }

    // Handle Android back button navigation
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {

        if (keyCode == KeyEvent.KEYCODE_BACK) {

            if (this.bridge.getWebView().canGoBack()) {
                this.bridge.getWebView().goBack();
                return true;
            } else {

                if (lastBackPressed + 2000 > System.currentTimeMillis()) {
                    finish();
                    return true;
                } else {
                    Toast.makeText(this, "Press back again to exit", Toast.LENGTH_SHORT).show();
                    lastBackPressed = System.currentTimeMillis();
                    return true;
                }
            }
        }

        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onResume() {
        super.onResume();

        // Re-enable immersive mode if user swiped to show bars
        final View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        );
    }

    @Override
    public void onPause() {
        super.onPause();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
    }
}
