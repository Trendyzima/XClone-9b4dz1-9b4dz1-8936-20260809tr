package com.xclone.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.view.View;

public final class SplashCanvasView extends View {
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Typeface heavy = Typeface.create("sans-serif-black", Typeface.BOLD);
    private int screen = 0;

    public SplashCanvasView(Context context) {
        super(context);
        p.setTypeface(heavy);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        setLayerType(View.LAYER_TYPE_SOFTWARE, null);
    }

    public void setScreen(int value) {
        screen = Math.max(0, Math.min(2, value));
        invalidate();
    }

    @Override
    protected void onDraw(Canvas c) {
        super.onDraw(c);
        float w = getWidth();
        float h = getHeight();

        int top = Color.rgb(3, 18, 11);
        int bottom = screen == 0 ? Color.rgb(5, 55, 28)
                : screen == 1 ? Color.rgb(3, 45, 25)
                : Color.rgb(4, 31, 20);

        p.setShader(new LinearGradient(0, 0, w, h, top, bottom, Shader.TileMode.CLAMP));
        c.drawRect(0, 0, w, h, p);
        p.setShader(null);

        drawTexture(c, w, h);
        if (screen == 0) drawConnect(c, w, h);
        if (screen == 1) drawLive(c, w, h);
        if (screen == 2) drawDiscover(c, w, h);

        drawFooter(c, w, h);
    }

    private void drawTexture(Canvas c, float w, float h) {
        stroke.setColor(Color.argb(30, 255, 255, 255));
        stroke.setStrokeWidth(1.5f);
        for (int i = -2; i < 12; i++) {
            c.drawLine(i * w / 7f, 0, i * w / 7f + h * .22f, h, stroke);
        }
        stroke.setColor(Color.argb(38, 80, 255, 150));
        stroke.setStrokeWidth(2f);
        c.drawCircle(w * .82f, h * .18f, w * .38f, stroke);
        c.drawCircle(w * .82f, h * .18f, w * .29f, stroke);
    }

    private void drawConnect(Canvas c, float w, float h) {
        drawTag(c, "CONNECT", w * .08f, h * .27f, w * .84f);
        drawChatBubble(c, w * .18f, h * .57f, w * .58f, h * .12f);
        drawChatBubble(c, w * .28f, h * .68f, w * .47f, h * .10f);
        drawNodes(c, w, h);
        drawCaption(c, "PEOPLE  •  POSTS  •  COMMUNITIES", w * .08f, h * .82f);
    }

    private void drawLive(Canvas c, float w, float h) {
        drawTag(c, "WATCH LIVE", w * .08f, h * .25f, w * .84f);
        p.setColor(Color.WHITE);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(7);
        c.drawRoundRect(w * .14f, h * .45f, w * .86f, h * .67f, 22, 22, p);
        p.setStyle(Paint.Style.FILL);
        Path play = new Path();
        play.moveTo(w * .46f, h * .50f);
        play.lineTo(w * .46f, h * .62f);
        play.lineTo(w * .60f, h * .56f);
        play.close();
        p.setColor(Color.rgb(61, 255, 132));
        c.drawPath(play, p);
        p.setColor(Color.rgb(255, 70, 82));
        c.drawCircle(w * .22f, h * .49f, 9, p);
        drawCaption(c, "SPORTS  •  MUSIC  •  NEWS  •  WORLD TV", w * .08f, h * .80f);
    }

    private void drawDiscover(Canvas c, float w, float h) {
        drawTag(c, "DISCOVER", w * .08f, h * .27f, w * .84f);
        stroke.setStrokeWidth(8);
        stroke.setColor(Color.rgb(61, 255, 132));
        Path wave = new Path();
        for (int i = 0; i <= 12; i++) {
            float x = w * .10f + i * w * .067f;
            float y = h * .57f + (float)Math.sin(i * .9) * h * .055f;
            if (i == 0) wave.moveTo(x, y); else wave.lineTo(x, y);
        }
        c.drawPath(wave, stroke);
        drawCards(c, w, h);
        drawCaption(c, "CREATORS  •  VIDEO  •  MUSIC  •  IDEAS", w * .08f, h * .82f);
    }

    private void drawTag(Canvas c, String text, float x, float y, float maxW) {
        c.save();
        c.rotate(-3f, x, y);
        p.setTypeface(heavy);
        p.setTextSize(Math.min(maxW / text.length() * 1.55f, getWidth() * .135f));
        p.setStyle(Paint.Style.FILL);
        p.setColor(Color.WHITE);
        p.setShadowLayer(18, 0, 8, Color.argb(120, 0, 0, 0));
        c.drawText(text, x, y, p);
        p.clearShadowLayer();

        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(3.5f);
        p.setColor(Color.rgb(61, 255, 132));
        c.drawText(text, x + 5, y - 3, p);
        p.setStyle(Paint.Style.FILL);
        c.restore();
    }

    private void drawChatBubble(Canvas c, float l, float t, float r, float b) {
        p.setColor(Color.argb(235, 255, 255, 255));
        c.drawRoundRect(l, t, r, b, 26, 26, p);
        p.setColor(Color.rgb(5, 55, 28));
        c.drawCircle(l + 28, (t + b) / 2, 8, p);
        c.drawCircle(l + 52, (t + b) / 2, 8, p);
        c.drawCircle(l + 76, (t + b) / 2, 8, p);
    }

    private void drawNodes(Canvas c, float w, float h) {
        stroke.setColor(Color.argb(150, 61, 255, 132));
        stroke.setStrokeWidth(3);
        float[][] n = {{.12f,.46f},{.83f,.47f},{.18f,.74f},{.78f,.73f}};
        for (float[] a : n) {
            c.drawLine(w*.50f, h*.62f, w*a[0], h*a[1], stroke);
            p.setColor(Color.rgb(61,255,132));
            c.drawCircle(w*a[0], h*a[1], 8, p);
        }
    }

    private void drawCards(Canvas c, float w, float h) {
        float[] xs = {.14f, .38f, .62f};
        float[] hs = {.12f, .15f, .10f};
        for (int i = 0; i < xs.length; i++) {
            p.setColor(Color.argb(235, 255, 255, 255));
            c.drawRoundRect(w*xs[i], h*.43f, w*(xs[i]+.20f), h*(.43f+hs[i]), 18, 18, p);
            p.setColor(i == 1 ? Color.rgb(61,255,132) : Color.rgb(10,35,22));
            c.drawCircle(w*(xs[i]+.04f), h*.47f, 9, p);
        }
    }

    private void drawCaption(Canvas c, String text, float x, float y) {
        p.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        p.setTextSize(Math.max(12, getWidth() * .032f));
        p.setLetterSpacing(.08f);
        p.setColor(Color.argb(210, 220, 255, 232));
        c.drawText(text, x, y, p);
        p.setLetterSpacing(0);
    }

    private void drawFooter(Canvas c, float w, float h) {
        p.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        p.setTextSize(Math.max(13, w * .035f));
        p.setColor(Color.argb(190, 255, 255, 255));
        c.drawText("TESTAGRAM", w * .08f, h * .93f, p);

        p.setTextSize(Math.max(10, w * .025f));
        p.setColor(Color.argb(120, 190, 255, 210));
        c.drawText("CONNECT • WATCH • DISCOVER", w * .08f, h * .958f, p);
    }
}
