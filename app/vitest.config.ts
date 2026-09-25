import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // extensions/sonar 是独立工程，拥有自己的 vitest 配置与 @ 别名；
    // 根工程测试不应纳入它，否则会因别名缺失而失败。
    exclude: ['**/node_modules/**', '**/dist/**', 'extensions/**'],
    server: {
      deps: {
        inline: ['@pikoloo/darwin-ui', 'react-day-picker'],
      },
    },
  },
});
