package app.ignisverbi;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class DateChangeReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null) return;
    String action = intent.getAction();
    Log.d("DateChangeReceiver","onReceive action="+action+" ts="+System.currentTimeMillis());
    try {
      if (RefreshScheduler.ACTION_MIDNIGHT_ALARM.equals(action)
          || Intent.ACTION_DATE_CHANGED.equals(action)
          || Intent.ACTION_TIME_CHANGED.equals(action)
          || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
        String cause;
        if (RefreshScheduler.ACTION_MIDNIGHT_ALARM.equals(action)) { Log.d("DateChangeReceiver","MIDNIGHT ALARM FIRED"); cause = "alarm"; }
        else if (Intent.ACTION_DATE_CHANGED.equals(action)) cause = "date_changed";
        else if (Intent.ACTION_TIME_CHANGED.equals(action)) cause = "time_changed";
        else if (Intent.ACTION_TIMEZONE_CHANGED.equals(action)) cause = "timezone_changed";
        else cause = "unknown";
        RefreshScheduler.performDailyRefresh(context, cause);
        RefreshScheduler.scheduleMidnightAlarm(context);
        Log.d("DateChangeReceiver","Refresh + reschedule done for action="+action);
      } else if (Intent.ACTION_USER_PRESENT.equals(action)) {
        RefreshScheduler.performDailyRefresh(context, "user_present");
        Log.d("DateChangeReceiver","USER_PRESENT trigger refresh executed");
      } else if (RefreshScheduler.ACTION_DEBUG_ALARM.equals(action)) {
        Log.d("DateChangeReceiver","DEBUG ALARM FIRED");
        RefreshScheduler.performDailyRefresh(context, "debug_alarm");
      } else if (RefreshScheduler.ACTION_FORCE_REFRESH.equals(action)) {
        Log.d("DateChangeReceiver","FORCE REFRESH broadcast received");
        RefreshScheduler.performDailyRefresh(context, "manual_broadcast");
      } else if (Intent.ACTION_BOOT_COMPLETED.equals(action)) {
        Log.d("DateChangeReceiver","BOOT_COMPLETED – re-scheduling");
        RefreshScheduler.scheduleMidnightAlarm(context);
        RefreshScheduler.ensureDailyWork(context);
      }
    } catch (Throwable t) {
      Log.e("DateChangeReceiver","Falha ao processar", t);
    }
  }
}