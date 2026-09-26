import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HighlightSourceObservationError,
  observeAuthorizedLocalSourceSha256,
} from '../../electron/highlights/local-source-observer';

const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lingji-source-observer-'));
  roots.push(root);
  const allowed = join(root, 'authorized');
  mkdirSync(allowed);
  return { root, allowed };
}

async function expectUnavailable(promise: Promise<unknown>) {
  let error: unknown;
  try { await promise; } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(HighlightSourceObservationError);
  expect((error as HighlightSourceObservationError).code).toBe('source_unavailable');
  expect(String((error as Error).message)).not.toContain('authorized');
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    const checked = resolve(root);
    if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('lingji-source-observer-')) {
      throw new Error('unsafe source observer test cleanup path');
    }
    rmSync(checked, { recursive: true, force: true });
  }
});

describe('observeAuthorizedLocalSourceSha256（仅合成本地字节）', () => {
  it('逐字节计算实际文件摘要，改写后摘要变化且不记录文件内容', async () => {
    const { allowed } = fixture();
    const videoPath = join(allowed, 'synthetic.mp4');
    const original = Buffer.from('synthetic-recording-001');
    writeFileSync(videoPath, original);
    const signal = new AbortController().signal;
    const first = await observeAuthorizedLocalSourceSha256({ rootDir: allowed, videoPath, signal });
    expect(first).toBe(createHash('sha256').update(original).digest('hex'));
    writeFileSync(videoPath, 'synthetic-recording-002');
    const second = await observeAuthorizedLocalSourceSha256({ rootDir: allowed, videoPath, signal });
    expect(second).not.toBe(first);
    expect(readFileSync(videoPath, 'utf8')).toBe('synthetic-recording-002');
  });

  it('拒绝授权根目录外文件、目录与相对路径，错误不泄露路径', async () => {
    const { root, allowed } = fixture();
    const outside = join(root, 'outside.mp4');
    writeFileSync(outside, 'private-recording');
    const signal = new AbortController().signal;
    await expectUnavailable(observeAuthorizedLocalSourceSha256({ rootDir: allowed, videoPath: outside, signal }));
    await expectUnavailable(observeAuthorizedLocalSourceSha256({ rootDir: allowed, videoPath: allowed, signal }));
    await expectUnavailable(observeAuthorizedLocalSourceSha256({ rootDir: allowed, videoPath: 'relative.mp4', signal }));
  });

  it('开始前已取消或源文件缺失时固定失败', async () => {
    const { allowed } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expectUnavailable(observeAuthorizedLocalSourceSha256({
      rootDir: allowed, videoPath: join(allowed, 'missing.mp4'), signal: controller.signal,
    }));
    await expectUnavailable(observeAuthorizedLocalSourceSha256({
      rootDir: allowed, videoPath: join(allowed, 'missing.mp4'), signal: new AbortController().signal,
    }));
  });

  it.skipIf(process.platform === 'win32')('拒绝符号链接录屏（Windows 建链权限另行验收）', async () => {
    const { allowed } = fixture();
    const actual = join(allowed, 'actual.mp4');
    const link = join(allowed, 'link.mp4');
    writeFileSync(actual, 'synthetic-recording');
    symlinkSync(actual, link, 'file');
    await expectUnavailable(observeAuthorizedLocalSourceSha256({
      rootDir: allowed, videoPath: link, signal: new AbortController().signal,
    }));
  });
});
