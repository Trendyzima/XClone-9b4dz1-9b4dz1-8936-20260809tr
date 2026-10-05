package com.xclone.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.ImageView;
import android.widget.LinearLayout;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.splashscreen.SplashScreen;

public final class SplashActivity extends AppCompatActivity {
    private static final int[] SCREENS = {
            R.drawable.splash_1,
            R.drawable.splash_2,
            R.drawable.splash_3
    };
    private static final long SCREEN_MS = 700L;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ImageView image;
    private int index = 0;
    private boolean handedOff = false;

    @Override
    protected void onCreate(Bundle state) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(state);
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        hideSystemBars();

        image = new ImageView(this);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setBackgroundColor(android.graphics.Color.rgb(245, 250, 247));
        image.setImageResource(SCREENS[0]);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(android.view.Gravity.CENTER);
        root.addView(image, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);

        image.setAlpha(0f);
        image.animate().alpha(1f).setDuration(220L).start();
        handler.postDelayed(this::nextScreen, SCREEN_MS);
    }

    private void nextScreen() {
        if (isFinishing() || handedOff) return;
        index++;
        if (index >= SCREENS.length) {
            launchMain();
            return;
        }
        image.animate().alpha(0f).setDuration(160L).withEndAction(() -> {
            if (isFinishing() || handedOff) return;
            image.setImageResource(SCREENS[index]);
            image.animate().alpha(1f).setDuration(180L).start();
            handler.postDelayed(this::nextScreen, SCREEN_MS);
        }).start();
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
            if (controller != null) controller.hide(WindowInsets.Type.systemBars());
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
