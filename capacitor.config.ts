import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.skillorbit.app',
  appName: 'SkillOrbit',
  webDir: 'dist',
  android: {
    // Android WebView and API traffic use HTTPS in production.
    allowMixedContent: false,
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#f7faf9',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },
}

export default config
