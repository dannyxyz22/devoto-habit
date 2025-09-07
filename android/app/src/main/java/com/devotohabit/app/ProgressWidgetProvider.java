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

    // Set background to progress_widget.png if present, otherwise keep default background
    int resId = context.getResources().getIdentifier("progress_widget", "drawable", context.getPackageName());
    if (resId != 0) {
      views.setInt(R.id.widget_root, "setBackgroundResource", resId);
    }

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

    // Update progress bar and label
    views.setInt(R.id.widget_progress_bar, "setMax", 100);
    views.setInt(R.id.widget_progress_bar, "setProgress", percent);
    views.setTextViewText(R.id.widget_progress_text, hasGoal ? (percent + "%") : "Sem meta");

    // Click launches app
    Intent intent = new Intent(context, MainActivity.class);
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    PendingIntent pi = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE);
    views.setOnClickPendingIntent(R.id.widget_root, pi);

    appWidgetManager.updateAppWidget(appWidgetId, views);
  }
}
