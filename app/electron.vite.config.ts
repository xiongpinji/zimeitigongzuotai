import { defineConfig } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'node:fs';

// Plugin: copy stealth.min.js into dist-electron/ so that
// electron/publish/stealth.ts can resolve it at runtime via __dirname.
function copyStealthPlugin() {
  return {
    name: 'copy-stealth-min-js',
    closeBundle() {
      mkdirSync('dist-electron', { recursive: true });
      copyFileSync(
        resolve('electron/publish/stealth.min.js'),
        resolve('dist-electron/stealth.min.js'),
      );
    },
  };
}

export default defineConfig({
  main: {
    plugins: [copyStealthPlugin()],
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      lib: {
        entry: resolve('electron/main.ts'),
        formats: ['cjs'],
        fileName: () => 'main.js',
      },
      rollupOptions: {
        // @earendil-works/pi-coding-agent 是 ESM-only，且运行时会读取自身包目录下的
        // docs/skills 等资源，必须保持 external（由 dynamic import() 在运行时从
        // node_modules 解析），不能打包进 main.js。
        // node-pty 是原生模块（含 .node 预编译产物 + spawn-helper），不能被 rollup 打包，
        // 必须 external，由运行时 require 从 node_modules 解析（B 站扫码登录用）。
        external: ['zod', 'node-pty', /^@earendil-works\//],
      },
    },
  },
  preload: {
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      lib: {
        entry: resolve('electron/preload.ts'),
        formats: ['cjs'],
        fileName: () => 'preload.js',
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: resolve('index.html'),
      },
    },
  },
});
