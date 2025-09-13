package com.devotohabit.app;

import android.content.Context;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public class RefreshWorker extends Worker {
  public RefreshWorker(@NonNull Context context, @NonNull WorkerParameters params) {
    super(context, params);
  }

  @NonNull
  @Override
  public Result doWork() {
    try {
  long start = System.currentTimeMillis();
  Log.d("RefreshWorker","Iniciando doWork ts="+start);
      // Captura payload antes
  String before = null; String after = null; String key = "widget:dailyProgress"; String prefsFile = "CapacitorStorage";
  try { before = getApplicationContext().getSharedPreferences(prefsFile, Context.MODE_PRIVATE).getString(key, null); } catch (Throwable ignored) {}
      Log.d("RefreshWorker","PayloadBefore="+before);

      RefreshScheduler.performDailyRefresh(getApplicationContext(), "work_manager");
      try {
        ProgressWidgetProvider.triggerUpdate(getApplicationContext(), "worker");
        Log.d("RefreshWorker","triggerUpdate executado origin=worker");
      } catch (Throwable t) { Log.e("RefreshWorker","Falha triggerUpdate", t); }

      // Captura payload depois
  try { after = getApplicationContext().getSharedPreferences(prefsFile, Context.MODE_PRIVATE).getString(key, null); } catch (Throwable ignored) {}
      Log.d("RefreshWorker","PayloadAfter="+after);
  long end = System.currentTimeMillis();
  Log.d("RefreshWorker","Concluido doWork durMs="+(end-start));
  return Result.success();
    } catch (Throwable t) {
      Log.e("RefreshWorker","Falha", t);
      return Result.retry();
    }
  }
}