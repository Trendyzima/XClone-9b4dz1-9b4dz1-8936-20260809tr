package com.xclone.app;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.splashscreen.SplashScreen;

public final class SplashActivity extends AppCompatActivity {
    private static final long SCREEN_MS = 3600L;
    private static final long FADE_MS = 650L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private SplashCanvasView splash;
    private int index = 0;
    private boolean handedOff = false;

    @Override
    protected void onCreate(Bundle state) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(state);

        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        hideSystemBars();

        splash = new SplashCanvasView(this);
        splash.setScreen(index);
        setContentView(splash);

        splash.setAlpha(0f);
        splash.animate().alpha(1f).setDuration(FADE_MS).start();
        handler.postDelayed(this::nextScreen, SCREEN_MS);
    }

    private void nextScreen() {
        if (isFinishing() || handedOff) return;

        index++;
        if (index >= 3) {
            launchMain();
            return;
        }

        splash.animate()
                .alpha(0f)
                .setDuration(FADE_MS)
                .withEndAction(() -> {
                    if (isFinishing() || handedOff) return;
                    splash.setScreen(index);
                    splash.animate().alpha(1f).setDuration(FADE_MS).start();
                    handler.postDelayed(this::nextScreen, SCREEN_MS);
                })
                .start();
    }

    private void launchMain() {
        handedOff = true;
        Intent next = new Intent(this, MainActivity.class);
        next.setAction(getIntent().getAction());
        next.setData(getIntent().getData());
        next.putExtras(getIntent());
        startActivity(next);
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
        finish();
    }

    private void hideSystemBars() {
        Window window = getWindow();
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN |
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
