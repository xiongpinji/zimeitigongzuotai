import fs from 'node:fs/promises';
import path from 'node:path';
import type { PromptBindingMap } from '../src/types/ai';

const PROJECT_FILE = path.join('configs', 'prompt-bindings.json');

function projectFilePath(projectDir: string): string {
  return path.join(projectDir, PROJECT_FILE);
}

async function readJsonIfExists(filePath: string): Promise<PromptBindingMap> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as PromptBindingMap;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

export interface PromptBindingsCtx {
  projectDir: string;
}

export async function readPromptBindings(ctx: PromptBindingsCtx): Promise<PromptBindingMap> {
  return readJsonIfExists(projectFilePath(ctx.projectDir));
}

export async function writePromptBindings(
  bindings: PromptBindingMap,
  ctx: PromptBindingsCtx,
): Promise<void> {
  const filePath = projectFilePath(ctx.projectDir);
  const isEmpty = !bindings || Object.keys(bindings).length === 0;
  if (isEmpty) {
    await deletePromptBindings(ctx);
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(bindings, null, 2), 'utf-8');
}

export async function deletePromptBindings(ctx: PromptBindingsCtx): Promise<void> {
  try {
    await fs.unlink(projectFilePath(ctx.projectDir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
