package app.ignisverbi;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Recebe eventos diários e relacionados a tempo/usuário: meia-noite (alarm), mudança de data/hora,
 * timezone, boot, user present, e ações de debug/força. Consolida todos os gatilhos que podem exigir
 * recomputar ou resetar o progresso diário.
 */
public class DailyEventsReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null) return;
    String action = intent.getAction();
    Log.d("DailyEventsReceiver","onReceive action="+action+" ts="+System.currentTimeMillis());
    try {
    if (RefreshScheduler.ACTION_MIDNIGHT_ALARM.equals(action)
      || Intent.ACTION_DATE_CHANGED.equals(action)
      || Intent.ACTION_TIME_CHANGED.equals(action)
      || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
        String cause;
        if (RefreshScheduler.ACTION_MIDNIGHT_ALARM.equals(action)) { Log.d("DailyEventsReceiver","MIDNIGHT ALARM FIRED"); cause = "alarm"; }
        else if (Intent.ACTION_DATE_CHANGED.equals(action)) cause = "date_changed";
        else if (Intent.ACTION_TIME_CHANGED.equals(action)) cause = "time_changed";
        else if (Intent.ACTION_TIMEZONE_CHANGED.equals(action)) cause = "timezone_changed";
        else cause = "unknown";
        RefreshScheduler.performDailyRefresh(context, cause);
        RefreshScheduler.scheduleMidnightAlarm(context);
        Log.d("DailyEventsReceiver","Refresh + reschedule done for action="+action);
      } else if (Intent.ACTION_USER_PRESENT.equals(action)) {
        RefreshScheduler.performDailyRefresh(context, "user_present");
        Log.d("DailyEventsReceiver","USER_PRESENT trigger refresh executed");
      } else if (RefreshScheduler.ACTION_DEBUG_ALARM.equals(action)) {
        Log.d("DailyEventsReceiver","DEBUG ALARM FIRED");
        RefreshScheduler.performDailyRefresh(context, "debug_alarm");
      } else if (RefreshScheduler.ACTION_FORCE_REFRESH.equals(action)) {
        Log.d("DailyEventsReceiver","FORCE REFRESH broadcast received");
        RefreshScheduler.performDailyRefresh(context, "manual_broadcast");
      } else if (Intent.ACTION_BOOT_COMPLETED.equals(action)) {
        Log.d("DailyEventsReceiver","BOOT_COMPLETED – re-scheduling");
        RefreshScheduler.performDailyRefresh(context, "boot_completed");
        RefreshScheduler.scheduleMidnightAlarm(context);
        RefreshScheduler.ensureDailyWork(context);
      }
    } catch (Throwable t) {
      Log.e("DailyEventsReceiver","Falha ao processar", t);
    }
  }
}
