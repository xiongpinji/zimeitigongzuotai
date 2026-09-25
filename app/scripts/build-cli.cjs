// scripts/build-cli.cjs
const esbuild = require('esbuild');
const fs = require('node:fs');

esbuild
  .build({
    entryPoints: ['cli/src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    outfile: 'dist-cli/lingji.mjs',
    banner: { js: '#!/usr/bin/env node' },
  })
  .then(() => {
    fs.chmodSync('dist-cli/lingji.mjs', 0o755);
    console.log('[build-cli] dist-cli/lingji.mjs 构建完成');
  })
  .catch((err) => {
    console.error('[build-cli] 失败:', err);
    process.exit(1);
  });
