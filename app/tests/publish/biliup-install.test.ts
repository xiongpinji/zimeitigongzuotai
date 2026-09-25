import { describe, it, expect, vi } from 'vitest';

// biliup-install.ts 顶层 import { app } from 'electron'；node 环境下需 mock。
vi.mock('electron', () => ({
  app: { getPath: (name: string) => `/tmp/userData-${name}` },
}));

import {
  selectAsset,
  pinnedAsset,
  withProxy,
  buildDownloadCandidates,
  getBiliupDestRoot,
  downloadBiliup,
} from '../../electron/publish/biliup-install';

const ASSETS = [
  { name: 'bbup-app_0.1.0_x64-setup.exe', browser_download_url: 'u0' },
  { name: 'biliupR-v1.2.1-aarch64-macos.tar.xz', browser_download_url: 'mac-arm' },
  { name: 'biliupR-v1.2.1-x86_64-macos.tar.xz', browser_download_url: 'mac-x64' },
  { name: 'biliupR-v1.2.1-x86_64-linux-musl.tar.xz', browser_download_url: 'linux-musl' },
  { name: 'biliupR-v1.2.1-x86_64-linux.tar.xz', browser_download_url: 'linux-x64' },
  { name: 'biliupR-v1.2.1-x86_64-windows.zip', browser_download_url: 'win' },
];

describe('selectAsset', () => {
  it('按平台 key 选中正确资产', () => {
    expect(selectAsset(ASSETS, 'macos-aarch64').downloadUrl).toBe('mac-arm');
    expect(selectAsset(ASSETS, 'windows-x86_64').downloadUrl).toBe('win');
  });

  it('linux-x86_64 不会误命中 *-musl 变体', () => {
    const r = selectAsset(ASSETS, 'linux-x86_64');
    expect(r.assetName).toBe('biliupR-v1.2.1-x86_64-linux.tar.xz');
    expect(r.downloadUrl).toBe('linux-x64');
  });

  it('未知平台 / 缺资产时抛错', () => {
    expect(() => selectAsset(ASSETS, 'plan9-foo')).toThrow();
    expect(() => selectAsset([], 'macos-aarch64')).toThrow();
  });
});

describe('pinnedAsset', () => {
  it('用 pin 版本构造资产名与官方直链', () => {
    const r = pinnedAsset('macos-aarch64', 'v1.2.1');
    expect(r.assetName).toBe('biliupR-v1.2.1-aarch64-macos.tar.xz');
    expect(r.downloadUrl).toBe(
      'https://github.com/biliup/biliup/releases/download/v1.2.1/biliupR-v1.2.1-aarch64-macos.tar.xz',
    );
  });

  it('windows 用 .zip 后缀', () => {
    expect(pinnedAsset('windows-x86_64', 'v1.2.1').assetName).toBe(
      'biliupR-v1.2.1-x86_64-windows.zip',
    );
  });
});

describe('代理优先 URL 生成', () => {
  it('withProxy 前缀拼接', () => {
    expect(withProxy('https://ghproxy.net/', 'https://github.com/x')).toBe(
      'https://ghproxy.net/https://github.com/x',
    );
  });

  it('buildDownloadCandidates 代理在前、官方直连兜底在最后', () => {
    const url = 'https://github.com/biliup/biliup/releases/download/v1.2.1/x.tar.xz';
    const candidates = buildDownloadCandidates(url);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[candidates.length - 1]).toBe(url); // 直连兜底
    expect(candidates.slice(0, -1).every((c) => c.endsWith(url))).toBe(true); // 其余均为代理前缀
    expect(candidates[0]).not.toBe(url); // 首选是代理
  });
});

describe('getBiliupDestRoot', () => {
  it('落在 userData/publish 下', () => {
    expect(getBiliupDestRoot()).toBe('/tmp/userData-userData/publish');
  });
});

describe('downloadBiliup 取消', () => {
  it('signal 已 abort 时直接返回已取消，不触发网络解析', async () => {
    const ac = new AbortController();
    ac.abort();
    const res = await downloadBiliup(undefined, ac.signal);
    expect(res).toEqual({ success: false, error: '已取消' });
  });
});
