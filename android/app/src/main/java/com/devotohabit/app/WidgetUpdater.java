package com.devotohabit.app;

import android.util.Log;
import java.util.Arrays;

import android.content.Context;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "WidgetUpdater")
public class WidgetUpdater extends Plugin {
  @PluginMethod
  public void update(PluginCall call) {
    try {
      Context ctx = getContext();
        Log.d("WidgetUpdater", "update() chamado do React");

      ProgressWidgetProvider.triggerUpdate(ctx);
  // Also broadcast explicit update to ensure some launchers refresh immediately
  Intent intent = new Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
  int[] ids = AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, ProgressWidgetProvider.class));
  intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
  ctx.sendBroadcast(intent);
      call.resolve();
    } catch (Throwable t) {
         Log.e("WidgetUpdater", "Falha ao atualizar widget", t);
      call.reject("Failed to update widget");
    }
  }
}
