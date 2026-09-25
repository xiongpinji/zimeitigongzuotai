import { describe, it, expect, afterEach } from 'vitest';
import {
  buildPlatformKey,
  biliupBinaryName,
  resolveBiliupPath,
  configureBiliupRoot,
} from '../../electron/publish/biliup-runtime';

it('平台 key 归一化 darwin/arm64 → macos-aarch64', () => {
  expect(buildPlatformKey('darwin', 'arm64')).toBe('macos-aarch64');
  expect(buildPlatformKey('win32', 'x64')).toBe('windows-x86_64');
});
it('归一化 amd64/x64 → x86_64, linux 保持 linux', () => {
  expect(buildPlatformKey('linux', 'amd64')).toBe('linux-x86_64');
  expect(buildPlatformKey('linux', 'x64')).toBe('linux-x86_64');
});
it('windows 用 biliup.exe，其它用 biliup', () => {
  expect(biliupBinaryName('win32')).toBe('biliup.exe');
  expect(biliupBinaryName('darwin')).toBe('biliup');
  expect(biliupBinaryName('linux')).toBe('biliup');
});

describe('configureBiliupRoot 注入安装根目录', () => {
  afterEach(() => configureBiliupRoot(null));

  it('注入后 resolveBiliupPath 默认从注入目录解析', () => {
    configureBiliupRoot('/data/userData/publish');
    const p = resolveBiliupPath();
    expect(p.startsWith('/data/userData/publish/biliup/')).toBe(true);
    expect(p.endsWith(biliupBinaryName())).toBe(true);
  });

  it('显式传入 resourcesRoot 优先于注入值', () => {
    configureBiliupRoot('/data/userData/publish');
    expect(resolveBiliupPath('/custom').startsWith('/custom/biliup/')).toBe(true);
  });

  it('清空注入后回退（不再用注入目录）', () => {
    configureBiliupRoot('/data/userData/publish');
    configureBiliupRoot(null);
    expect(resolveBiliupPath().startsWith('/data/userData/publish/')).toBe(false);
  });
});
