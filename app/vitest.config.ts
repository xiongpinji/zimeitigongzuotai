import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // extensions/sonar 是独立工程；.tmp 是打包生成区，两者都不属于源码测试。
    exclude: ['**/node_modules/**', '**/dist/**', '**/.tmp/**', 'extensions/**'],
    server: {
      deps: {
        inline: ['@pikoloo/darwin-ui', 'react-day-picker'],
      },
    },
  },
});
