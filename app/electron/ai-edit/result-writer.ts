import fs from 'node:fs/promises';
import path from 'node:path';
import type { EditError } from '../../src/lib/external-edit-validate';

export interface EditResult {
  ok: boolean;
  at: string;
  errors: EditError[];
}

export function buildEditResult(errors: EditError[], at: string): EditResult {
  return { ok: errors.length === 0, at, errors };
}

export async function writeEditResult(projectDir: string, result: EditResult): Promise<void> {
  const dir = path.join(projectDir, '.lingji');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'edit-result.json'), JSON.stringify(result, null, 2), 'utf-8');
}
