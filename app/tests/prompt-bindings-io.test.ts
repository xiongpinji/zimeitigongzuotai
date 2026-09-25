import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  readPromptBindings,
  writePromptBindings,
  deletePromptBindings,
} from '../electron/prompt-bindings-io';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pbio-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('prompt-bindings-io', () => {
  it('读不存在的项目文件：返回空对象', async () => {
    const r = await readPromptBindings({ projectDir: tmp });
    expect(r).toEqual({});
  });

  it('write → read 往返一致', async () => {
    await writePromptBindings(
      { 'planning.segment': { providerId: 'A', model: 'm1' } },
      { projectDir: tmp },
    );
    const r = await readPromptBindings({ projectDir: tmp });
    expect(r).toEqual({ 'planning.segment': { providerId: 'A', model: 'm1' } });
    const filePath = path.join(tmp, 'configs', 'prompt-bindings.json');
    expect(await fs.stat(filePath)).toBeTruthy();
  });

  it('写入空 map：删除文件', async () => {
    await writePromptBindings({ 'planning.segment': { providerId: 'A', model: 'm' } },
                              { projectDir: tmp });
    await writePromptBindings({}, { projectDir: tmp });
    const filePath = path.join(tmp, 'configs', 'prompt-bindings.json');
    await expect(fs.stat(filePath)).rejects.toThrow();
    expect(await readPromptBindings({ projectDir: tmp })).toEqual({});
  });

  it('deletePromptBindings 删除项目文件，幂等', async () => {
    await writePromptBindings({ 'planning.segment': { providerId: 'A', model: 'm' } },
                              { projectDir: tmp });
    await deletePromptBindings({ projectDir: tmp });
    await deletePromptBindings({ projectDir: tmp });
    expect(await readPromptBindings({ projectDir: tmp })).toEqual({});
  });
});
