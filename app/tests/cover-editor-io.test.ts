import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { saveCoverEdit } from '../electron/cover-editor-io';

describe('saveCoverEdit', () => {
  let tmp = '';
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-edit-'));
    await fs.mkdir(path.join(tmp, 'covers'), { recursive: true });
  });

  const pngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  it('append 模式写入新文件并返回新候选', async () => {
    const result = await saveCoverEdit({
      projectDir: tmp,
      sourceCandidateId: 'src-1',
      sourceImageUrl: path.join(tmp, 'covers', 'cover-src-1.png'),
      sourcePrompt: 'test',
      dataUrl: pngDataUrl,
      edits: { version: 1 },
      mode: 'append',
    });
    expect(result.editedFrom).toBe('src-1');
    expect(result.imageUrl).toMatch(/edited-.*\.png$/);
    expect(result.replacedId).toBeUndefined();
    const stat = await fs.stat(result.imageUrl);
    expect(stat.isFile()).toBe(true);
  });

  it('overwrite 模式覆盖原文件并返回 replacedId', async () => {
    const sourcePath = path.join(tmp, 'covers', 'cover-src-2.png');
    await fs.writeFile(sourcePath, 'old');
    const result = await saveCoverEdit({
      projectDir: tmp,
      sourceCandidateId: 'src-2',
      sourceImageUrl: sourcePath,
      sourcePrompt: 'test',
      dataUrl: pngDataUrl,
      edits: { version: 1 },
      mode: 'overwrite',
    });
    expect(result.candidateId).toBe('src-2');
    expect(result.replacedId).toBe('src-2');
    expect(result.imageUrl.startsWith(sourcePath)).toBe(true);
    // 文件已被覆盖（大小与原 "old" 不同）
    const stat = await fs.stat(sourcePath);
    expect(stat.size).toBeGreaterThan(3);
  });
});
