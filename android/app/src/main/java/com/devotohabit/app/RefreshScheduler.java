package com.devotohabit.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.util.Log;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.Calendar;
import java.util.concurrent.TimeUnit;

/** Centraliza lógica para reagendar e disparar atualização do widget ao virar o dia. */
public class RefreshScheduler {
  public static final String ACTION_MIDNIGHT_ALARM = "com.devotohabit.app.ACTION_MIDNIGHT_ALARM";
  public static final String ACTION_DEBUG_ALARM = "com.devotohabit.app.ACTION_DEBUG_ALARM"; // manual test
  public static final String ACTION_FORCE_REFRESH = "com.devotohabit.app.ACTION_FORCE_REFRESH"; // manual broadcast
  private static final String UNIQUE_WORK = "DailyWidgetRefresh";
  private static final String META_KEY = "widget:lastRefreshMeta"; // diagnostic JSON
  private static final String SCHEDULE_META_KEY = "widget:lastAlarmSchedule"; // stores last scheduled times

  /** Função DRY: recalcula (aqui apenas zera percent) e força atualização do widget. */
  public static void performDailyRefresh(Context ctx) { performDailyRefresh(ctx, "auto"); }

  public static void performDailyRefresh(Context ctx, String cause) {
    try {
      String key = "widget:dailyProgress";
      String[] files = new String[]{"CapacitorStorage","CapacitorStorageNative","com.capacitorjs.preferences","Preferences"};
      String found = null; String fileFound = null;
      for (String f: files) {
        try { String cur = ctx.getSharedPreferences(f, Context.MODE_PRIVATE).getString(key, null); if (cur != null) { found = cur; fileFound = f; break; } } catch (Throwable ignored) {}
      }
      String today = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(new java.util.Date());
      Log.d("RefreshScheduler","performDailyRefresh cause="+cause+" file="+fileFound+" rawPayload="+found);
      boolean needsReset = false;
      boolean prevHasGoal = false;
      if (found == null) {
        needsReset = true;
      } else {
        try {
          org.json.JSONObject obj = new org.json.JSONObject(found);
          String day = obj.optString("day", null);
          prevHasGoal = obj.optBoolean("hasGoal", false);
          if (day == null || !day.equals(today)) { needsReset = true; }
        } catch (Throwable t) { needsReset = true; }
      }
      Log.d("RefreshScheduler","needsReset="+needsReset+" prevHasGoal="+prevHasGoal);
      if (needsReset) {
        // Reset otimista imediato
        long nowReset = System.currentTimeMillis();
        String optimistic = "{\"percent\":0,\"hasGoal\":"+prevHasGoal+",\"ts\":"+nowReset+",\"day\":\""+today+"\"}";
        try {
          ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).edit().putString(key, optimistic).apply();
          Log.d("RefreshScheduler","Reset otimista imediato aplicado");
          org.json.JSONObject metaOpt = new org.json.JSONObject();
          metaOpt.put("ts", nowReset);
          metaOpt.put("cause", cause);
          metaOpt.put("phase", "optimistic_reset");
          metaOpt.put("prevHasGoal", prevHasGoal);
          ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).edit().putString(META_KEY, metaOpt.toString()).apply();
        } catch (Throwable ignored) {}
  ProgressWidgetProvider.triggerUpdate(ctx, "refresh_scheduler");
        // Tenta JS recomputar (pode sobrescrever com percent real >=0)
        try {
          Intent i = new Intent(ctx, MainActivity.class);
          i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
          i.putExtra("devota_force_refresh", true);
          ctx.startActivity(i);
          Log.d("RefreshScheduler","Start activity para recomputo JS após reset otimista cause="+cause);
        } catch (Throwable t) {
          Log.e("RefreshScheduler","Falha ao iniciar activity pós reset otimista", t);
        }
      } else {
        Log.d("RefreshScheduler","Payload de hoje detectado (sem reset)");
        try {
          org.json.JSONObject meta = new org.json.JSONObject();
          meta.put("ts", System.currentTimeMillis());
          meta.put("cause", cause);
          meta.put("phase", "already_today");
          ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).edit().putString(META_KEY, meta.toString()).apply();
        } catch (Throwable ignored) {}
      }
    } catch (Throwable t) {
      Log.e("RefreshScheduler","Falha performDailyRefresh", t);
    }
  }

  /** Agenda um alarm exato para o próximo midnight local. */
  public static void scheduleMidnightAlarm(Context ctx) {
    try {
      Calendar cal = Calendar.getInstance();
      cal.add(Calendar.DAY_OF_YEAR,1);
      cal.set(Calendar.HOUR_OF_DAY,0);
      cal.set(Calendar.MINUTE,0);
      cal.set(Calendar.SECOND,0);
      cal.set(Calendar.MILLISECOND,0);
      long triggerAt = cal.getTimeInMillis();
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      // Use explicit intent to avoid any implicit broadcast restrictions
      Intent midnightIntent = new Intent(ctx, DateChangeReceiver.class);
      midnightIntent.setAction(ACTION_MIDNIGHT_ALARM);
      PendingIntent pi = PendingIntent.getBroadcast(ctx, 1010, midnightIntent, PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
      if (am != null) {
    // Sempre usar window (não exato) para simplificar e evitar necessidade de permissão
    long windowLength = 15*60*1000L; // 15 minutos
    Log.d("RefreshScheduler","Agendando alarm midnight (forçando setWindow) target="+cal.getTime()+" windowMs="+windowLength);
    am.setWindow(AlarmManager.RTC_WAKEUP, triggerAt, windowLength, pi);
    // Fallback +60s (também window) somente como redundância leve
        long fallbackAt = triggerAt + 60_000L;
        Intent fallbackIntent = new Intent(ctx, DateChangeReceiver.class);
        fallbackIntent.setAction(ACTION_MIDNIGHT_ALARM);
        fallbackIntent.putExtra("fallback", true);
        PendingIntent fallbackPi = PendingIntent.getBroadcast(ctx, 1011, fallbackIntent, PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
    am.setWindow(AlarmManager.RTC_WAKEUP, fallbackAt, windowLength, fallbackPi);
    Log.d("RefreshScheduler","Fallback window +60s agendado="+new java.util.Date(fallbackAt));
        // Persist schedule metadata
        try {
          org.json.JSONObject meta = new org.json.JSONObject();
            meta.put("scheduledTs", System.currentTimeMillis());
            meta.put("midnightAt", triggerAt);
            meta.put("fallbackAt", fallbackAt);
      meta.put("forcedWindow", true);
            ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).edit().putString(SCHEDULE_META_KEY, meta.toString()).apply();
        } catch (Throwable ignored) {}
      }
    } catch (Throwable t) { Log.e("RefreshScheduler","Erro scheduleMidnightAlarm", t); }
  }

  /** Agenda WorkManager periódico alinhado à próxima meia-noite. */
  public static void ensureDailyWork(Context ctx) {
    try {
      long now = System.currentTimeMillis();
      Calendar cal = Calendar.getInstance();
      cal.add(Calendar.DAY_OF_YEAR,1);
      cal.set(Calendar.HOUR_OF_DAY,0);
      cal.set(Calendar.MINUTE,0);
      cal.set(Calendar.SECOND,0);
      cal.set(Calendar.MILLISECOND,0);
      long nextMidnight = cal.getTimeInMillis();
      long delayMs = nextMidnight - now;
      if (delayMs < 0) delayMs = TimeUnit.MINUTES.toMillis(5);
      if (delayMs >= TimeUnit.HOURS.toMillis(24)) delayMs = TimeUnit.HOURS.toMillis(23);
      Log.d("RefreshScheduler","ensureDailyWork periodic initialDelayMs="+delayMs);
      PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(RefreshWorker.class, 24, TimeUnit.HOURS)
        .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
        .addTag("daily_refresh_periodic")
        .build();
      // UPDATE para substituir caso parâmetros mudem.
      WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(UNIQUE_WORK, ExistingPeriodicWorkPolicy.REPLACE, req);
    } catch (Throwable t) { Log.e("RefreshScheduler","Erro ensureDailyWork periodic", t); }
  }

  /** Debug: schedule one-off alarm in N seconds. */
  public static void scheduleDebugAlarm(Context ctx, int seconds) {
    try {
      long triggerAt = System.currentTimeMillis() + seconds * 1000L;
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      PendingIntent pi = PendingIntent.getBroadcast(ctx, 2020, new Intent(ACTION_DEBUG_ALARM), PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
      if (am != null) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        Log.d("RefreshScheduler","Debug alarm agendado para "+seconds+"s");
      }
    } catch (Throwable t) { Log.e("RefreshScheduler","Erro scheduleDebugAlarm", t); }
  }
}