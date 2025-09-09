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
  const today = new Date().toISOString().slice(0,10)
  const payload = { percent: Math.max(0, Math.min(100, Math.round(percent || 0))), hasGoal: !!hasGoal, ts: Date.now(), day: today }
    await Preferences.set({ key: 'widget:dailyProgress', value: JSON.stringify(payload) })
  } catch {}
}
