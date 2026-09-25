import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ensureCardAssetDir,
  writeCardImage,
  writeCardVideo,
  writeCardPoster,
  writeCardMeta,
  readCardMeta,
  deleteCardAssets,
  type CardAssetMeta,
} from '../electron/ai-card-assets';

const META_FIXTURE: CardAssetMeta = {
  cardId: 'c1',
  mediaType: 'image',
  prompt: 'p',
  providerId: 'pv1',
  model: 'm1',
  aspectRatio: '16:9',
  generatedAt: 1,
};

describe('ai-card-assets', () => {
  let projectDir = '';
  beforeEach(async () => {
    projectDir = await mkdtemp(path.join(tmpdir(), 'aicard-'));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('ensureCardAssetDir 幂等创建目录', async () => {
    const dir = await ensureCardAssetDir(projectDir, 'c1');
    await ensureCardAssetDir(projectDir, 'c1');
    expect((await stat(dir)).isDirectory()).toBe(true);
  });

  it('writeCardImage 写到 ai-cards/<id>/image.png 并返回相对路径', async () => {
    const rel = await writeCardImage(projectDir, 'c1', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(rel).toBe(path.join('ai-cards', 'c1', 'image.png'));
    const data = await readFile(path.join(projectDir, rel));
    expect(data.length).toBe(4);
  });

  it('writeCardVideo 写到 ai-cards/<id>/video.mp4 并返回相对路径', async () => {
    const rel = await writeCardVideo(projectDir, 'c1', Buffer.from([0, 0, 0, 1]));
    expect(rel).toBe(path.join('ai-cards', 'c1', 'video.mp4'));
  });

  it('writeCardPoster 写到 poster.jpg', async () => {
    const rel = await writeCardPoster(projectDir, 'c1', Buffer.from([0xff, 0xd8]));
    expect(rel).toBe(path.join('ai-cards', 'c1', 'poster.jpg'));
  });

  it('writeCardMeta + readCardMeta 往返一致', async () => {
    await writeCardMeta(projectDir, 'c1', META_FIXTURE);
    const meta = await readCardMeta(projectDir, 'c1');
    expect(meta?.prompt).toBe('p');
    expect(meta?.cardId).toBe('c1');
  });

  it('readCardMeta 不存在时返回 null', async () => {
    const meta = await readCardMeta(projectDir, 'never');
    expect(meta).toBeNull();
  });

  it('deleteCardAssets 清空目录', async () => {
    await writeCardImage(projectDir, 'c1', Buffer.from([1]));
    await writeCardMeta(projectDir, 'c1', META_FIXTURE);
    await deleteCardAssets(projectDir, 'c1');
    await expect(stat(path.join(projectDir, 'ai-cards', 'c1'))).rejects.toBeTruthy();
  });

  it('deleteCardAssets 对不存在目录幂等', async () => {
    await expect(deleteCardAssets(projectDir, 'never')).resolves.toBeUndefined();
  });
});
