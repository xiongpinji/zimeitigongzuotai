import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.config';

// 声呐 Sonar 构建：输出可通过「加载已解压的扩展程序」安装的目录（dist/）。
// 该工程与仓库根的 Electron 应用隔离，拥有独立依赖与构建配置。
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [react(), crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        offscreen: fileURLToPath(new URL('./src/offscreen/index.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    hmr: {
      port: 5181,
    },
  },
});
