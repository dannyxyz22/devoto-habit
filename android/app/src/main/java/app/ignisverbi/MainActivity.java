package app.ignisverbi;

import android.os.Bundle;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.util.Log;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import app.ignisverbi.WidgetUpdater;
import app.ignisverbi.RefreshScheduler;

public class MainActivity extends BridgeActivity {
	private BroadcastReceiver userPresentReceiver;

	@Override
	public void onCreate(Bundle savedInstanceState) {
		// Install the splash screen before content is set
		SplashScreen.installSplashScreen(this);

		// Register plugin before bridge initialization to ensure availability
		registerPlugin(WidgetUpdater.class);
		super.onCreate(savedInstanceState);
		WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
		// Schedule midnight alarm & ensure periodic work
		RefreshScheduler.scheduleMidnightAlarm(this.getApplicationContext());
		RefreshScheduler.ensureDailyWork(this.getApplicationContext());

		// Removido pedido de autorização de exact alarms (não mais necessário)

		// Se iniciado por RefreshScheduler ou Widget para refresh silencioso
		if (getIntent() != null && getIntent().getBooleanExtra("devota_force_refresh", false)) {
			Log.d("MainActivity", "Iniciado para refresh silencioso (widget/replication)");
			// Post para garantir que o WebView já inicializou
			getWindow().getDecorView().postDelayed(() -> {
				try {
					Log.d("MainActivity", "Executando devotaDailyRefresh via JavaScript");
					this.getBridge().getWebView()
							.evaluateJavascript("window.devotaDailyRefresh && window.devotaDailyRefresh()", null);
					// Fecha a Activity após um delay para dar tempo do JavaScript executar
					getWindow().getDecorView().postDelayed(() -> {
						Log.d("MainActivity", "Fechando Activity após refresh silencioso");
						finish();
					}, 2000); // 2 segundos devem ser suficientes para o refresh
				} catch (Throwable t) {
					Log.e("MainActivity", "Erro ao executar refresh silencioso", t);
					finish();
				}
			}, 600);
		}
	}

	@Override
	public void onResume() {
		super.onResume();
		if (userPresentReceiver == null) {
			userPresentReceiver = new BroadcastReceiver() {
				@Override
				public void onReceive(Context context, Intent intent) {
					if (Intent.ACTION_USER_PRESENT.equals(intent.getAction())) {
						Log.d("MainActivity", "Dynamic USER_PRESENT recebido");
						try {
							RefreshScheduler.performDailyRefresh(getApplicationContext(), "user_present_dynamic");
						} catch (Throwable ignored) {
						}
					}
				}
			};
			IntentFilter f = new IntentFilter(Intent.ACTION_USER_PRESENT);
			try {
				registerReceiver(userPresentReceiver, f);
				Log.d("MainActivity", "USER_PRESENT dynamic receiver registrado");
			} catch (Throwable t) {
				Log.e("MainActivity", "Falha registrar USER_PRESENT dynamic", t);
			}
		}
	}

}
