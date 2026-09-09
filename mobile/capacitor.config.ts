import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.agentos.app',
  appName: 'AgentOS',
  webDir: '../frontend/out',
  plugins: { App: { launchAutoHide: true } }
};

export default config;
