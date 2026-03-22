import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'nz.amo.app',
  appName: 'Amo',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
