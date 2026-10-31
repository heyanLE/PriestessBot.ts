import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = env['VITE_DASHBOARD_PORT'] || '18080';
  const backendUrl = `http://127.0.0.1:${backendPort}`;

  return {
    plugins: [vue()],
    server: {
      port: 5173,
      proxy: {
        '/api/ts': `http://127.0.0.1:${env['VITE_TS_PORT'] || '8081'}`,
        '/api': backendUrl,
        '/health': backendUrl,
        '/ws': {
          target: `ws://127.0.0.1:${backendPort}`,
          ws: true,
        },
      },
    },
  };
});
