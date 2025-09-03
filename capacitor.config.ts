import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.devotohabit.app',
  appName: 'devoto-habit',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
