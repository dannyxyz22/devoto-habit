import { Capacitor, registerPlugin } from '@capacitor/core';

export interface WidgetUpdaterPlugin {
  update(): Promise<void>;
}

export const WidgetUpdater = registerPlugin<WidgetUpdaterPlugin>('WidgetUpdater');

export function canUseNative() {
  return (Capacitor.isNativePlatform?.() ?? (Capacitor.getPlatform?.() !== 'web')) as boolean;
}
