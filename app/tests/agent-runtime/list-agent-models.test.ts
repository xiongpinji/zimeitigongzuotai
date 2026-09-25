import { describe, it, expect, vi } from 'vitest';
import { listAgentModels } from '../../electron/agent-runtime/detection';
import { parsePiModels, piAgentDef } from '../../electron/agent-runtime/agent-defs/pi';
import type { RuntimeAgentDef } from '../../electron/agent-runtime/types';

// ─── parsePiModels（纯函数）─────────────────────────────────────────────────

describe('parsePiModels', () => {
  it('解析表格：跳过表头，合成 provider/model，前置 default', () => {
    const raw = [
      'provider   model              context',
      'anthropic  claude-sonnet-4-5  200K',
      'openai     gpt-5              400K',
    ].join('\n');
    const models = parsePiModels(raw);
    expect(models).not.toBeNull();
    expect(models!.map((m) => m.id)).toEqual([
      'default',
      'anthropic/claude-sonnet-4-5',
      'openai/gpt-5',
    ]);
  });

  it('跳过 # 注释行与空行', () => {
    const raw = [
      '# pi models',
      '',
      'provider  model',
      'google    gemini-2.5-pro',
    ].join('\n');
    const models = parsePiModels(raw);
    expect(models!.map((m) => m.id)).toEqual(['default', 'google/gemini-2.5-pro']);
  });

  it('去重重复的 provider/model', () => {
    const raw = [
      'provider  model',
      'openai    gpt-5',
      'openai    gpt-5',
    ].join('\n');
    const models = parsePiModels(raw);
    expect(models!.filter((m) => m.id === 'openai/gpt-5')).toHaveLength(1);
  });

  it('空输入 / 仅表头 → null', () => {
    expect(parsePiModels('')).toBeNull();
    expect(parsePiModels('   ')).toBeNull();
    expect(parsePiModels('provider  model')).toBeNull(); // 只有表头
  });
});

// ─── listAgentModels ──────────────────────────────────────────────────────

function fakeBM(resolved: string | null) {
  return { resolveBinary: vi.fn().mockResolvedValue(resolved) };
}

describe('listAgentModels', () => {
  it('def 无 listModelsArgs/parseModels（静态 agent）→ fallback', async () => {
    const def: RuntimeAgentDef = {
      id: 'static',
      name: 'Static',
      bin: 'static',
      versionArgs: ['--version'],
      buildArgs: () => [],
      streamFormat: 'pi-rpc',
      models: [{ id: 'static-model-1', label: 'Static' }],
    };
    const res = await listAgentModels(fakeBM('/usr/bin/static') as never, def);
    expect(res.source).toBe('fallback');
    expect(res.models.map((m) => m.id)).toContain('static-model-1');
  });

  it('bin 解析不到 → fallback（不执行）', async () => {
    const res = await listAgentModels(fakeBM(null) as never, piAgentDef);
    expect(res.source).toBe('fallback');
    expect(res.models.map((m) => m.id)).toContain('default');
  });

  it('live：从 stdout 解析（用 node 输出表格）', async () => {
    const def: RuntimeAgentDef = {
      id: 't',
      name: 'T',
      bin: 't',
      versionArgs: ['--version'],
      buildArgs: () => [],
      streamFormat: 'pi-rpc',
      listModelsArgs: ['-e', 'process.stdout.write("provider model\\nopenai gpt-5")'],
      modelsOutputStream: 'stdout',
      parseModels: parsePiModels,
      fallbackModels: [{ id: 'default', label: 'Default' }],
    };
    const res = await listAgentModels(fakeBM(process.execPath) as never, def);
    expect(res.source).toBe('live');
    expect(res.models.map((m) => m.id)).toEqual(['default', 'openai/gpt-5']);
  });

  it('live：从 stderr 解析（pi 把表格打到 stderr）', async () => {
    const def: RuntimeAgentDef = {
      id: 't',
      name: 'T',
      bin: 't',
      versionArgs: ['--version'],
      buildArgs: () => [],
      streamFormat: 'pi-rpc',
      listModelsArgs: ['-e', 'process.stderr.write("provider model\\nanthropic claude-opus-4-5")'],
      modelsOutputStream: 'stderr',
      parseModels: parsePiModels,
      fallbackModels: [{ id: 'default', label: 'Default' }],
    };
    const res = await listAgentModels(fakeBM(process.execPath) as never, def);
    expect(res.source).toBe('live');
    expect(res.models.map((m) => m.id)).toEqual(['default', 'anthropic/claude-opus-4-5']);
  });

  it('声明流解析失败时回退到另一条流（CLI 版本差异容错）', async () => {
    // 声明 stdout，但实际输出在 stderr → 仍应解析成功。
    const def: RuntimeAgentDef = {
      id: 't',
      name: 'T',
      bin: 't',
      versionArgs: ['--version'],
      buildArgs: () => [],
      streamFormat: 'pi-rpc',
      listModelsArgs: ['-e', 'process.stderr.write("provider model\\nopenai gpt-5")'],
      modelsOutputStream: 'stdout',
      parseModels: parsePiModels,
      fallbackModels: [{ id: 'default', label: 'Default' }],
    };
    const res = await listAgentModels(fakeBM(process.execPath) as never, def);
    expect(res.source).toBe('live');
    expect(res.models.map((m) => m.id)).toContain('openai/gpt-5');
  });

  it('解析为空 → fallback', async () => {
    const def: RuntimeAgentDef = {
      id: 't',
      name: 'T',
      bin: 't',
      versionArgs: ['--version'],
      buildArgs: () => [],
      streamFormat: 'pi-rpc',
      listModelsArgs: ['-e', 'process.stdout.write("")'],
      modelsOutputStream: 'stdout',
      parseModels: parsePiModels,
      fallbackModels: [{ id: 'default', label: 'Default' }, { id: 'x/y', label: 'x/y' }],
    };
    const res = await listAgentModels(fakeBM(process.execPath) as never, def);
    expect(res.source).toBe('fallback');
    expect(res.models.map((m) => m.id)).toEqual(['default', 'x/y']);
  });

  it('真实 pi def 走进程内 SDK：无 CLI listModelsArgs → listAgentModels 返回 fallback', async () => {
    // pi 模型列表现由 buildPiModelOptions 按 App provider 投影生成（见 acp/ipc.ts），
    // 不再经 CLI `--list-models`。故通用 listAgentModels 对 pi def 直接回落 fallback。
    const result = await listAgentModels(
      { resolveBinary: async () => null },
      piAgentDef,
      { resolveBundledEntry: () => null, execPath: '/abs/electron', execFileAsync: async () => ({ stdout: '', stderr: '' }) },
    );
    expect(result.source).toBe('fallback');
    expect(result.models.length).toBeGreaterThan(0);
  });
});
