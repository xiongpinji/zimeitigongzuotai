import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext } from 'playwright';

// Use import.meta.url for path resolution:
// - Under Vitest (ESM): import.meta.url is natively available.
// - Under Electron main (CJS, built by electron-vite): electron-vite transforms
//   import.meta.url to the correct CJS __filename equivalent at build time.
const _dirname = dirname(fileURLToPath(import.meta.url));

let cached: string | null = null;
function stealthScript(): string {
  if (cached == null) cached = readFileSync(join(_dirname, 'stealth.min.js'), 'utf-8');
  return cached;
}

export async function applyStealth(context: BrowserContext): Promise<BrowserContext> {
  await context.addInitScript(stealthScript());
  return context;
}
