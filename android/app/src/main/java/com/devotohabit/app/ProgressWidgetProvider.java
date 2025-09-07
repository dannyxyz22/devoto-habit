package com.devotohabit.app;

import java.util.Arrays;
import android.util.Log;


import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.RemoteViews;

import org.json.JSONObject;

public class ProgressWidgetProvider extends AppWidgetProvider {
  // Try multiple SharedPreferences files that Capacitor Preferences may use across versions/packages
  private static final String[] PREF_FILES = new String[] {
    "CapacitorStorage",                 // common
    "CapacitorStorageNative",          // some versions
    "com.capacitorjs.preferences",     // hypothetical alt
    "Preferences"                       // generic
  };
  private static final String KEY = "widget:dailyProgress";   // JSON string { percent, hasGoal, ts }

  @Override
  public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
    for (int appWidgetId : appWidgetIds) {
      updateAppWidget(context, appWidgetManager, appWidgetId);
    }
  }

  @Override
  public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager, int appWidgetId, Bundle newOptions) {
    updateAppWidget(context, appWidgetManager, appWidgetId);
  }

  public static void triggerUpdate(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    int[] ids = manager.getAppWidgetIds(new ComponentName(context, ProgressWidgetProvider.class));
    
     Log.d("ProgressWidgetProvider", "triggerUpdate chamado, ids=" + Arrays.toString(ids));
    if (ids != null && ids.length > 0) {
       
      for (int id : ids) {
            Log.d("ProgressWidgetProvider", "Atualizando widget id=" + id);
            updateAppWidget(context, manager, id);
      } 
    }
  }

  private static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_progress);
    // Preferred: use drawable resource widget_background (place widget_background.png in res/drawable)
    int bgRes = context.getResources().getIdentifier("widget_background", "drawable", context.getPackageName());
    if (bgRes != 0) {
      try {
        // Create a rounded bitmap mask so the image corners match the widget shape
        android.graphics.Bitmap src = android.graphics.BitmapFactory.decodeResource(context.getResources(), bgRes);
        if (src != null) {
          int w = src.getWidth();
          int h = src.getHeight();
          android.graphics.Bitmap out = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888);
          android.graphics.Canvas canvas = new android.graphics.Canvas(out);
          android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
          android.graphics.RectF rf = new android.graphics.RectF(0, 0, w, h);
          float radius = Math.min(w, h) * 0.08f; // ~8% rounding
          paint.setColor(0xFFFFFFFF);
          canvas.drawRoundRect(rf, radius, radius, paint);
          paint.setXfermode(new android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN));
          canvas.drawBitmap(src, 0, 0, paint);
          views.setImageViewBitmap(R.id.widget_bg, out);
        } else {
          views.setImageViewResource(R.id.widget_bg, bgRes);
        }
      } catch (Throwable t) {
        views.setImageViewResource(R.id.widget_bg, bgRes);
      }
    } else {
      // Fallback to drawable resource background if present
      int resId = context.getResources().getIdentifier("progress_widget", "drawable", context.getPackageName());
      if (resId != 0) {
        views.setInt(R.id.widget_root, "setBackgroundResource", resId);
      }
    }

  // We'll adjust layout after knowing if there's a goal or not

    int percent = 0;
    boolean hasGoal = false;
    try {
      String json = null;
      for (String file : PREF_FILES) {
        try {
          SharedPreferences prefs = context.getSharedPreferences(file, Context.MODE_PRIVATE);
          json = prefs.getString(KEY, null);
          if (json != null) break;
        } catch (Throwable ignored) {}
      }
      if (json != null) {
        JSONObject obj = new JSONObject(json);
        percent = Math.max(0, Math.min(100, obj.optInt("percent", 0)));
        hasGoal = obj.optBoolean("hasGoal", false);
      }
    } catch (Throwable ignored) {}

    // Update layout based on whether there's a goal
    if (hasGoal) {
      // Position the progress bar at ~75% of height (padding on container)
      try {
        final float density = context.getResources().getDisplayMetrics().density;
        int heightDp = 110; // fallback
        try {
          android.os.Bundle opts = appWidgetManager.getAppWidgetOptions(appWidgetId);
          int maxH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
          int minH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
          int h = maxH > 0 ? maxH : (minH > 0 ? minH : 0);
          if (h > 0) heightDp = h;
        } catch (Throwable ignored2) {}
        int heightPx = (int) (heightDp * density);
        int desiredTop = (int) (heightPx * 0.75f);
        int barHalf = (int) (10f * density / 2f);
        int topPadding = Math.max(0, desiredTop - barHalf);
        views.setViewPadding(R.id.progress_container, 0, topPadding, 0, 0);

        // Emulate ConstraintLayout guidelines: place percent text container start=45% width, top=55% height
        try {
          int widthDp = 110; // fallback
          try {
            android.os.Bundle opts2 = appWidgetManager.getAppWidgetOptions(appWidgetId);
            int maxW = opts2.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0);
            int minW = opts2.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            int w = maxW > 0 ? maxW : (minW > 0 ? minW : 0);
            if (w > 0) widthDp = w;
          } catch (Throwable ignored3) {}
          int widthPx = (int) (widthDp * density);
          int leftPadding = (int) (widthPx * 0.40f);
          int textTopPadding = (int) (heightPx * 0.22f);
          views.setViewPadding(R.id.progress_text_container, leftPadding, textTopPadding, 0, 0);
        } catch (Throwable ignored4) {}
      } catch (Throwable ignored) {}

      views.setViewVisibility(R.id.widget_progress_bar, android.view.View.VISIBLE);
      views.setViewVisibility(R.id.widget_progress_text, android.view.View.VISIBLE);
      views.setViewVisibility(R.id.widget_progress_text_center, android.view.View.GONE);
      views.setInt(R.id.widget_progress_bar, "setMax", 100);
      views.setInt(R.id.widget_progress_bar, "setProgress", percent);
      views.setTextViewText(R.id.widget_progress_text, percent + "%");
    } else {
  // No goal: show only centered text
      views.setViewVisibility(R.id.widget_progress_bar, android.view.View.GONE);
      views.setViewVisibility(R.id.widget_progress_text, android.view.View.GONE);
      views.setViewVisibility(R.id.widget_progress_text_center, android.view.View.VISIBLE);
      views.setTextViewText(R.id.widget_progress_text_center, "Sem meta");
      // Reset padding in case it was set previously
      views.setViewPadding(R.id.progress_container, 0, 0, 0, 0);
  views.setViewPadding(R.id.progress_text_container, 0, 0, 0, 0);
    }

    // Click launches app
    Intent intent = new Intent(context, MainActivity.class);
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    PendingIntent pi = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE);
    views.setOnClickPendingIntent(R.id.widget_root, pi);

    appWidgetManager.updateAppWidget(appWidgetId, views);
  }
}
