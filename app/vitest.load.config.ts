import { defineConfig } from 'vitest/config';

// 显式运行本地容量门槛，避免让默认快速回归承担千任务磁盘 I/O。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/load/**/*.load.ts'],
    testTimeout: 600_000,
  },
});
