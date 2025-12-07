package app.ignisverbi;

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
import android.content.SharedPreferences;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import java.util.List;
import org.json.JSONObject;
import java.util.concurrent.ExecutionException;

@CapacitorPlugin(name = "WidgetUpdater")
public class WidgetUpdater extends Plugin {
  @PluginMethod
  public void update(PluginCall call) {
    try {
      Context ctx = getContext();
        Log.d("WidgetUpdater", "update() chamado do React");

      ProgressWidgetProvider.triggerUpdate(ctx, "WidgetUpdater");
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

  @PluginMethod
  public void setDailyProgress(PluginCall call) {
    try {
      Integer percent = call.getInt("percent");
      Boolean hasGoal = call.getBoolean("hasGoal");
      if (percent == null || hasGoal == null) { call.reject("Missing percent/hasGoal"); return; }
      int p = Math.max(0, Math.min(100, percent));
      String today = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(new java.util.Date());
      long now = System.currentTimeMillis();
      String payload = "{\"percent\":"+p+",\"hasGoal\":"+hasGoal+",\"ts\":"+now+",\"day\":\""+today+"\"}";
      Context ctx = getContext();
      ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).edit().putString("widget:dailyProgress", payload).apply();
      Log.d("WidgetUpdater","setDailyProgress persisted payload="+payload);
      ProgressWidgetProvider.triggerUpdate(ctx, "plugin_set");
      com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
      ret.put("saved", true);
      ret.put("payload", payload);
      call.resolve(ret);
    } catch (Throwable t) {
      call.reject("Failed setDailyProgress"+t);
    }
  }

  @PluginMethod
  public void getDailyProgress(PluginCall call) {
    try {
      Context ctx = getContext();
      String val = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString("widget:dailyProgress", null);
      com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
      ret.put("value", val);
      call.resolve(ret);
    } catch (Throwable t) {
      call.reject("Failed getDailyProgress"+t);
    }
  }

  @PluginMethod
  public void getDebugState(PluginCall call) {
    try {
      Context ctx = getContext();
      SharedPreferences prefs = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
      String progress = prefs.getString("widget:dailyProgress", null);
      String meta = prefs.getString("widget:lastRefreshMeta", null);
      String sched = prefs.getString("widget:lastAlarmSchedule", null);
      JSONObject root = new JSONObject();
      root.put("dailyProgress", progress);
      root.put("lastRefreshMeta", meta);
      root.put("lastAlarmSchedule", sched);
      // Worker info
      JSONObject workerInfo = new JSONObject();
      try {
        List<WorkInfo> infos = WorkManager.getInstance(ctx).getWorkInfosForUniqueWork("DailyWidgetRefresh").get();
        if (infos != null && !infos.isEmpty()) {
          WorkInfo wi = infos.get(0);
          workerInfo.put("id", wi.getId().toString());
          workerInfo.put("state", wi.getState().toString());
          if (wi.getRunAttemptCount() > 0) workerInfo.put("attempts", wi.getRunAttemptCount());
          long now = System.currentTimeMillis();
          workerInfo.put("queriedTs", now);
        }
      } catch (ExecutionException | InterruptedException e) { workerInfo.put("error", e.toString()); }
      root.put("worker", workerInfo);
      call.resolve(new com.getcapacitor.JSObject(root.toString()));
    } catch (Throwable t) {
      call.reject("Failed debug state"+t);
    }
  }

  @PluginMethod
  public void clearDebugData(PluginCall call) {
    try {
      Context ctx = getContext();
      SharedPreferences prefs = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
      prefs.edit()
        .remove("widget:dailyProgress")
        .remove("widget:lastRefreshMeta")
        .remove("widget:lastAlarmSchedule")
        .apply();
      call.resolve();
    } catch (Throwable t) {
      call.reject("Failed clear"+t);
    }
  }
}
