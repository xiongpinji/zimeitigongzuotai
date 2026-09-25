import { describe, it, expect, vi } from 'vitest';
import { detectAgent, createDetectionDeps } from '../../electron/agent-runtime/detection';
import type { RuntimeAgentDef } from '../../electron/agent-runtime/types';
import type { DetectionDeps } from '../../electron/agent-runtime/detection';

// ─── 测试夹具 ────────────────────────────────────────────────────────────────

function makeDef(overrides?: Partial<RuntimeAgentDef>): RuntimeAgentDef {
  return {
    id: 'claude',
    name: 'Claude',
    bin: 'claude',
    versionArgs: ['--version'],
    buildArgs: () => [],
    streamFormat: 'pi-rpc',
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<DetectionDeps>): DetectionDeps {
  return {
    resolveBinary: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────

describe('detectAgent', () => {
  it('bin 在 PATH（resolveBinary 返回路径）→ installed:true, binPath 匹配', async () => {
    const def = makeDef();
    const deps = makeDeps({
      resolveBinary: vi.fn().mockResolvedValue('/usr/local/bin/claude'),
    });

    const result = await detectAgent(def, deps);

    expect(result.installed).toBe(true);
    expect(result.binPath).toBe('/usr/local/bin/claude');
    expect(result.version).toBeNull();
    expect(deps.resolveBinary).toHaveBeenCalledWith('claude');
  });

  it('bin 不在 PATH（resolveBinary 返回 null，无 fallback）→ installed:false', async () => {
    const def = makeDef();
    const deps = makeDeps({
      resolveBinary: vi.fn().mockResolvedValue(null),
    });

    const result = await detectAgent(def, deps);

    expect(result.installed).toBe(false);
    expect(result.binPath).toBeNull();
    expect(result.version).toBeNull();
  });

  it('主 bin 未命中但 fallbackBins 命中 → installed:true, binPath 为 fallback 路径', async () => {
    const def = makeDef({
      bin: 'claude',
      fallbackBins: ['claude-cli', 'claude-code'],
    });
    // 主 bin 未找到，第一个 fallback 也未找到，第二个找到
    const resolveBinary = vi.fn()
      .mockResolvedValueOnce(null)          // 'claude'
      .mockResolvedValueOnce(null)          // 'claude-cli'
      .mockResolvedValueOnce('/opt/bin/claude-code'); // 'claude-code'

    const deps = makeDeps({ resolveBinary });

    const result = await detectAgent(def, deps);

    expect(result.installed).toBe(true);
    expect(result.binPath).toBe('/opt/bin/claude-code');
    expect(resolveBinary).toHaveBeenCalledTimes(3);
    expect(resolveBinary).toHaveBeenNthCalledWith(1, 'claude');
    expect(resolveBinary).toHaveBeenNthCalledWith(2, 'claude-cli');
    expect(resolveBinary).toHaveBeenNthCalledWith(3, 'claude-code');
  });

  it('fallbackBins 第一个命中 → 不继续尝试后续', async () => {
    const def = makeDef({
      bin: 'claude',
      fallbackBins: ['claude-cli', 'claude-code'],
    });
    const resolveBinary = vi.fn()
      .mockResolvedValueOnce(null)              // 'claude'
      .mockResolvedValueOnce('/usr/bin/claude-cli'); // 'claude-cli'

    const deps = makeDeps({ resolveBinary });

    const result = await detectAgent(def, deps);

    expect(result.installed).toBe(true);
    expect(result.binPath).toBe('/usr/bin/claude-cli');
    expect(resolveBinary).toHaveBeenCalledTimes(2); // 不应尝试第三个
  });

  it('probeVersion 返回版本 → version 字段带上版本字符串', async () => {
    const def = makeDef();
    const probeVersion = vi.fn().mockResolvedValue('1.2.3');
    const deps = makeDeps({
      resolveBinary: vi.fn().mockResolvedValue('/usr/local/bin/claude'),
      probeVersion,
    });

    const result = await detectAgent(def, deps);

    expect(result.installed).toBe(true);
    expect(result.version).toBe('1.2.3');
    expect(probeVersion).toHaveBeenCalledWith('/usr/local/bin/claude', ['--version']);
  });

  it('probeVersion 抛错 → version:null，不崩溃', async () => {
    const def = makeDef();
    const probeVersion = vi.fn().mockRejectedValue(new Error('spawn ENOENT'));
    const deps = makeDeps({
      resolveBinary: vi.fn().mockResolvedValue('/usr/local/bin/claude'),
      probeVersion,
    });

    const result = await detectAgent(def, deps);

    expect(result.installed).toBe(true);
    expect(result.binPath).toBe('/usr/local/bin/claude');
    expect(result.version).toBeNull();
  });

  it('未安装时不调用 probeVersion', async () => {
    const def = makeDef();
    const probeVersion = vi.fn();
    const deps = makeDeps({
      resolveBinary: vi.fn().mockResolvedValue(null),
      probeVersion,
    });

    await detectAgent(def, deps);

    expect(probeVersion).not.toHaveBeenCalled();
  });

  it('无 probeVersion dep 时，installed:true 但 version:null', async () => {
    const def = makeDef();
    const deps: DetectionDeps = {
      resolveBinary: vi.fn().mockResolvedValue('/usr/local/bin/claude'),
      // probeVersion 未提供
    };

    const result = await detectAgent(def, deps);

    expect(result.installed).toBe(true);
    expect(result.version).toBeNull();
  });

  it('多个 fallbackBins 全未命中 → installed:false', async () => {
    const def = makeDef({
      bin: 'claude',
      fallbackBins: ['claude-cli', 'claude-code'],
    });
    const deps = makeDeps({
      resolveBinary: vi.fn().mockResolvedValue(null),
    });

    const result = await detectAgent(def, deps);

    expect(result.installed).toBe(false);
    expect(result.binPath).toBeNull();
  });
});

describe('createDetectionDeps', () => {
  it('把 BinaryManagerLike 适配为 DetectionDeps，resolveBinary 透传', async () => {
    const bm = {
      resolveBinary: vi.fn().mockResolvedValue('/path/to/claude'),
    };

    const deps = createDetectionDeps(bm);
    const result = await deps.resolveBinary('claude');

    expect(result).toBe('/path/to/claude');
    expect(bm.resolveBinary).toHaveBeenCalledWith('claude');
  });

  it('probeVersion 超时/失败时返回 null（通过 stub 验证容错路径）', async () => {
    const bm = { resolveBinary: vi.fn().mockResolvedValue(null) };
    const deps = createDetectionDeps(bm);

    // probeVersion 是可选的；这里直接验证它在适配器上存在
    expect(typeof deps.probeVersion).toBe('function');

    // 调用一个不存在的二进制（应 ENOENT 并返回 null）
    const version = await deps.probeVersion!('/nonexistent/binary/path', ['--version']);
    expect(version).toBeNull();
  });
});
