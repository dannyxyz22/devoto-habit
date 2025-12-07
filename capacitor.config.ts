import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // The appId should match what's in your build.gradle
  appId: 'app.ignisverbi',
  appName: 'ignisverbi',
  webDir: 'dist',
  server: {
    // This tells Capacitor to handle https links
    androidScheme: 'https'
  },
  // Add this 'plugins' section to configure Google Sign-In
  plugins: {
    // Note: The key might be 'GoogleAuth' or 'GoogleSignIn'
    // depending on the exact plugin you are using.
    GoogleAuth: {
      scopes: ['profile', 'email'],
      // **IMPORTANT**: Replace this with your Web Client ID from the Google Cloud Console.
      // It is NOT the Android Client ID.
      serverClientId: '1044245386938-17oqsb47cec4had8ptou6mfosmnfes92.apps.googleusercontent.com',
      forceCodeForRefreshToken: true,
    }
  }
};

export default config;