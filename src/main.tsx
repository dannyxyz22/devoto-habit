import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { HelmetProvider } from 'react-helmet-async'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);

// Expose a tiny helper to update widget data (percent + hasGoal)
export async function updateDailyProgressWidget(percent: number, hasGoal: boolean) {
  try {
    const isNative = Capacitor.isNativePlatform?.() ?? (Capacitor.getPlatform?.() !== 'web')
    if (!isNative) return
  // Usar data local (não UTC) para evitar avançar para o "dia seguinte" em fusos negativos.
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  const payload = { percent: Math.max(0, Math.min(100, Math.round(percent || 0))), hasGoal: !!hasGoal, ts: Date.now(), day: today }
    // Prefer native atomic set via plugin if available
    const plugin: any = (window as any).Capacitor?.Plugins?.WidgetUpdater
    if (plugin?.setDailyProgress) {
      try {
        await plugin.setDailyProgress({ percent: payload.percent, hasGoal: payload.hasGoal })
      } catch (e) {
        console.log('[widget] native setDailyProgress failed, fallback Preferences.set', e)
        await Preferences.set({ key: 'widget:dailyProgress', value: JSON.stringify(payload) })
      }
    } else {
      await Preferences.set({ key: 'widget:dailyProgress', value: JSON.stringify(payload) })
    }
    console.log('[widget] wrote progress', payload)
  } catch {}
}
