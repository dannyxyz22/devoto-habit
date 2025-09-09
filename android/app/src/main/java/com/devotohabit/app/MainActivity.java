package com.devotohabit.app;

import android.os.Bundle;
import android.content.Intent;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import com.devotohabit.app.WidgetUpdater;
import com.devotohabit.app.RefreshScheduler;
public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(Bundle savedInstanceState) {
		// Register plugin before bridge initialization to ensure availability
		registerPlugin(WidgetUpdater.class);
		super.onCreate(savedInstanceState);
		WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
		// Schedule midnight alarm & ensure periodic work
		RefreshScheduler.scheduleMidnightAlarm(this.getApplicationContext());
		RefreshScheduler.ensureDailyWork(this.getApplicationContext());

		// Removido pedido de autorização de exact alarms (não mais necessário)

		// Se iniciado por RefreshScheduler para refresh silencioso
		if (getIntent() != null && getIntent().getBooleanExtra("devota_force_refresh", false)) {
			// Post para garantir que o WebView já inicializou
			getWindow().getDecorView().postDelayed(() -> {
				try {
					this.getBridge().getWebView().evaluateJavascript("window.devotaDailyRefresh && window.devotaDailyRefresh()", null);
				} catch (Throwable ignored) {}
			}, 600);
		}
	}
}
