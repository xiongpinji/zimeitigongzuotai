import fs from 'node:fs/promises';
import path from 'node:path';
import type { AISettings } from '../../src/types/ai';
import { buildPiAuthJson, buildPiModelsJson, buildPiSettingsJson } from './pi-provider-projection';

async function readExistingJson(filePath: string): Promise<Record<string, unknown>> {
  try {
    const text = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    throw error;
  }
}

/** 把 App AISettings 投影并写入 pi 配置目录（auth.json + settings.json + models.json）。 */
export async function writePiConfig(configDir: string, ai: AISettings): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, 'models.json'),
    JSON.stringify(buildPiModelsJson(ai), null, 2),
    'utf-8',
  );
  await fs.writeFile(
    path.join(configDir, 'settings.json'),
    JSON.stringify(buildPiSettingsJson(ai), null, 2),
    'utf-8',
  );
  const authPath = path.join(configDir, 'auth.json');
  const nextAuth = {
    ...(await readExistingJson(authPath)),
    ...buildPiAuthJson(ai),
  };
  await fs.writeFile(authPath, JSON.stringify(nextAuth, null, 2), 'utf-8');
}
