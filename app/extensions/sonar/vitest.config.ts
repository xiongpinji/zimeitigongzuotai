import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// 纯逻辑（适配器、解析排序、文件名、协议）在 node 环境下用固定夹具回归测试。
// 涉及浏览器 API 的模块（PageBridge / DownloadManager / Offscreen）后续用
// jsdom 或集成测试覆盖，不混入此处的纯函数单测。
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
