import { defineConfig } from 'vite';

// 前端：src/client → dist/client。开发时 `npm run dev:client`，/ws 和 /atlas 转给后端（npm run dev:server，8080）。
export default defineConfig({
  root: 'src/client',
  base: './',
  build: { outDir: '../../dist/client', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/atlas': 'http://localhost:8080',
    },
  },
});
