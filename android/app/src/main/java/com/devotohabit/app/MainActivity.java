package com.devotohabit.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import com.devotohabit.app.WidgetUpdater;
public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(Bundle savedInstanceState) {
		// Register plugin before bridge initialization to ensure availability
		registerPlugin(WidgetUpdater.class);
		super.onCreate(savedInstanceState);
		WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
	}
}
