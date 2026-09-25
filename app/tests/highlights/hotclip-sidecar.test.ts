/**
 * HotClip CLI sidecar 适配器测试。
 *
 * 全部用本机无害的 Node 假子进程（不触网、不调 LLM、不读真实媒体），
 * 证明的是「进程边界协议」：argv 构造、env 白名单、JSON 校验、超时 /
 * 取消 / 超限输出的子进程树终止与错误脱敏。这属于合成进程证据，
 * 不等于真实 HotClip 长任务行为（见 docs/validation/p0-3-hotclip-pilot.md）。
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import {
  buildHotClipHighlightsArgv,
  DEFAULT_MAX_OUTPUT_BYTES,
  HOTCLIP_MAX_CLIPS,
  HOTCLIP_MIN_CLIPS,
  HotClipSidecarError,
  parseHotClipCandidates,
  runHotClipHighlights,
} from '../../electron/highlights/hotclip-sidecar';

// 真实子进程集成测试在慢速主机（WSL/drvfs）上可能超过 vitest 默认 5s。
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ——————————————————————————————— 假子进程脚手架 ———————————————————————————————

const FAKE_CHILD_SOURCE = `'use strict';
const fs = require('fs');
const { spawn } = require('child_process');
const instr = JSON.parse(process.env.FAKE_INSTRUCTION || '{"mode":"empty-stdout"}');
function probe(extra) {
  if (!instr.probeFile) return;
  // 先写临时文件再原子替换：Windows 上 writeFileSync 会截断后写入，
  // 读取方可能看到空/半个 JSON（本机曾稳定复现 SyntaxError）。
  const payload = JSON.stringify(Object.assign({
    pid: process.pid,
    cwd: process.cwd(),
    argv: process.argv.slice(2),
    env: process.env,
  }, extra || {}));
  const tmpFile = instr.probeFile + '.tmp' + process.pid;
  fs.writeFileSync(tmpFile, payload);
  fs.renameSync(tmpFile, instr.probeFile);
}
probe();
const mode = instr.mode;
// 一律用 process.exitCode + 自然退出：process.exit() 可能截断管道上未刷新的写入。
if (mode === 'valid' || mode === 'bad-times' || mode === 'malformed-json' || mode === 'non-array') {
  if (mode === 'malformed-json') process.stdout.write('{oops not json');
  else if (mode === 'non-array') process.stdout.write('{"candidates":[]}');
  else process.stdout.write(JSON.stringify(instr.candidates));
  process.exitCode = 0;
} else if (mode === 'empty-stdout') {
  process.exitCode = 0;
} else if (mode === 'whitespace-stdout') {
  process.stdout.write('\\n  \\n');
  process.exitCode = 0;
} else if (mode === 'empty-array') {
  process.stdout.write('[]');
  process.exitCode = 0;
} else if (mode === 'exit-nonzero') {
  process.stderr.write(instr.stderr || 'RAW-STDERR-SECRET-marker');
  process.exitCode = instr.exitCode || 2;
} else if (mode === 'oversized' || mode === 'oversized-stderr') {
  const stream = mode === 'oversized' ? process.stdout : process.stderr;
  stream.write(Buffer.alloc(instr.bytes, mode === 'oversized' ? 0x78 : 0x79));
  stream.end();
  process.exitCode = 0;
} else if (mode === 'probe') {
  process.stdout.write('[]');
  process.exitCode = 0;
} else if (mode === 'sleep') {
  setInterval(() => {}, 1000);
} else if (mode === 'ignore-terms') {
  process.on('SIGTERM', () => {});
  process.on('SIGINT', () => {});
  process.on('SIGHUP', () => {});
  setInterval(() => {}, 1000);
} else if (mode === 'grandchild') {
  const gc = spawn(process.execPath, ['-e', 'setInterval(function(){},1000)'], { stdio: 'ignore' });
  gc.on('error', () => {});
  probe({ grandchildPid: gc.pid });
  setInterval(() => {}, 1000);
}
`;

const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeFakeChildScript(dir: string): string {
  const scriptPath = path.join(dir, 'fake-hotclip.cjs');
  fs.writeFileSync(scriptPath, FAKE_CHILD_SOURCE, 'utf8');
  return scriptPath;
}

interface FakeChildInstruction {
  mode: string;
  probeFile?: string;
  candidates?: unknown[];
  exitCode?: number;
  stderr?: string;
  bytes?: number;
}

interface FakeChildRunOptions {
  instruction: FakeChildInstruction;
  videoPath?: string;
  subtitlesPath?: string | null;
  maxClips?: number;
  timeoutMs?: number;
  maxOutputBytes?: number;
  killGraceMs?: number;
  cwd?: string;
  signal?: AbortSignal;
  env?: Record<string, string>;
  inheritBaseEnv?: boolean;
}

function runFakeChild(options: FakeChildRunOptions) {
  const dir = makeTmpDir('hotclip-sidecar-test-');
  const scriptPath = writeFakeChildScript(dir);
  const probeFile = path.join(dir, 'probe.json');
  const instruction: FakeChildInstruction = { ...options.instruction, probeFile };
  return runHotClipHighlights({
    executable: process.execPath,
    argsPrefix: [scriptPath],
    cwd: options.cwd ?? dir,
    videoPath: options.videoPath ?? path.join(dir, 'synthetic-recording.mp4'),
    subtitlesPath: options.subtitlesPath,
    maxClips: options.maxClips,
    timeoutMs: options.timeoutMs ?? 30_000,
    maxOutputBytes: options.maxOutputBytes,
    killGraceMs: options.killGraceMs,
    signal: options.signal,
    env: {
      FAKE_INSTRUCTION: JSON.stringify(instruction),
      ...(options.env ?? {}),
    },
    inheritBaseEnv: options.inheritBaseEnv,
  });
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fs.existsSync(filePath);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitForPidGone(pid: number, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isPidAlive(pid);
}

/** 收集错误对象上所有可序列化文本，用于「不泄密」断言。 */
function errorHaystack(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const own: Record<string, unknown> = { message: error.message, name: error.name };
  for (const [key, value] of Object.entries(error)) own[key] = value;
  return JSON.stringify(own);
}

const VALID_CANDIDATE = {
  id: 'clip-1',
  startSec: 12.345,
  endSec: 60.5,
  title: '合成候选标题',
  hook: '合成钩子句',
  score: 0.87,
  reason: '合成理由',
  recommended: true,
  reviewNote: null,
  visualEvidence: { frames: [1, 2] },
};

// ——————————————————————————————— 生命周期 ———————————————————————————————

// 记录被覆盖前的原值：vitest worker 跨文件复用，必须还原而非直接删除。
const secretMarkers: Array<[string, string | undefined]> = [];

afterEach(() => {
  for (const [key, previous] of secretMarkers.splice(0)) {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 上刚被杀的子进程可能短暂占用目录；临时目录清理失败不应让
      // 整个套件变成失败（断言已在各测试内完成）。
    }
  }
});

function plantSecretEnv(name: string, value: string): void {
  secretMarkers.push([name, process.env[name]]);
  process.env[name] = value;
}

// ——————————————————————————————— 纯函数：argv ———————————————————————————————

describe('buildHotClipHighlightsArgv', () => {
  it('builds the documented upstream CLI argv shape', () => {
    expect(
      buildHotClipHighlightsArgv({
        argsPrefix: ['cli'],
        videoPath: '/videos/rec.mp4',
        subtitlesPath: '/videos/rec.srt',
        maxClips: 5,
      }),
    ).toEqual(['cli', 'highlights', '/videos/rec.mp4', '--json', '--subtitles', '/videos/rec.srt', '--max-clips', '5']);
  });

  it('omits optional flags when subtitles and maxClips are absent', () => {
    expect(
      buildHotClipHighlightsArgv({ videoPath: '/videos/rec.mp4' }),
    ).toEqual(['highlights', '/videos/rec.mp4', '--json']);
  });
});

// ——————————————————————————————— 纯函数：候选解析 ———————————————————————————————

describe('parseHotClipCandidates', () => {
  it('converts seconds to exact milliseconds and preserves explanatory fields', () => {
    const parsed = parseHotClipCandidates(JSON.stringify([VALID_CANDIDATE]));
    expect(parsed).toEqual([
      {
        id: 'clip-1',
        startSec: 12.345,
        endSec: 60.5,
        startMs: 12_345,
        endMs: 60_500,
        title: '合成候选标题',
        hook: '合成钩子句',
        score: 0.87,
        reason: '合成理由',
        recommended: true,
        reviewNote: null,
        visualEvidence: { frames: [1, 2] },
      },
    ]);
  });

  it('treats empty or whitespace-only stdout as zero candidates', () => {
    expect(parseHotClipCandidates('')).toEqual([]);
    expect(parseHotClipCandidates('\n  \r\n')).toEqual([]);
    expect(parseHotClipCandidates('[]')).toEqual([]);
  });

  it('rejects non-array JSON with invalid_output', () => {
    expect(() => parseHotClipCandidates('{"candidates":[]}')).toThrowError(
      expect.objectContaining({ code: 'invalid_output' }),
    );
  });

  it('rejects malformed JSON without echoing output content', () => {
    let caught: unknown;
    try {
      parseHotClipCandidates('{oops SECRET_TRANSCRIPT_MARKER');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HotClipSidecarError);
    expect((caught as HotClipSidecarError).code).toBe('invalid_output');
    expect(errorHaystack(caught)).not.toContain('SECRET_TRANSCRIPT_MARKER');
  });

  const badCandidateCases: Array<[string, Record<string, unknown>]> = [
    ['missing object', null as unknown as Record<string, unknown>],
    ['blank id', { ...VALID_CANDIDATE, id: '  ' }],
    ['non-string id', { ...VALID_CANDIDATE, id: 7 }],
    ['string startSec', { ...VALID_CANDIDATE, startSec: '12.5' }],
    ['NaN-ish score', { ...VALID_CANDIDATE, score: null }],
    ['negative startSec', { ...VALID_CANDIDATE, startSec: -0.5 }],
    ['endSec equal to startSec', { ...VALID_CANDIDATE, startSec: 10, endSec: 10 }],
    ['endSec before startSec', { ...VALID_CANDIDATE, startSec: 10, endSec: 9.5 }],
    ['infinite endSec', { ...VALID_CANDIDATE, endSec: 1e400 }],
    ['non-boolean recommended', { ...VALID_CANDIDATE, recommended: 'yes' }],
    ['non-string title', { ...VALID_CANDIDATE, title: 42 }],
    ['missing hook', (() => { const { hook: _hook, ...rest } = VALID_CANDIDATE; return rest; })()],
    ['non-string reason', { ...VALID_CANDIDATE, reason: ['x'] }],
    ['non-string reviewNote', { ...VALID_CANDIDATE, reviewNote: 3 }],
  ];

  it.each(badCandidateCases)('rejects invalid candidate (%s)', (_label, candidate) => {
    expect(() => parseHotClipCandidates(JSON.stringify([candidate]))).toThrowError(
      expect.objectContaining({ code: 'invalid_output' }),
    );
  });

  it('does not leak candidate text content through invalid-candidate errors', () => {
    let caught: unknown;
    try {
      parseHotClipCandidates(
        JSON.stringify([{ ...VALID_CANDIDATE, title: 'SECRET-TITLE-文本', startSec: 'bad' }]),
      );
    } catch (error) {
      caught = error;
    }
    expect(errorHaystack(caught)).not.toContain('SECRET-TITLE-文本');
  });

  it('accepts absent reviewNote/visualEvidence by normalizing to null', () => {
    const { reviewNote: _rn, visualEvidence: _ve, ...rest } = VALID_CANDIDATE;
    const parsed = parseHotClipCandidates(JSON.stringify([rest]));
    expect(parsed[0]?.reviewNote).toBeNull();
    expect(parsed[0]?.visualEvidence).toBeNull();
  });
});

// ——————————————————————————————— 入参校验（不 spawn） ———————————————————————————————

describe('runHotClipHighlights option validation', () => {
  function baseOptions(overrides: Record<string, unknown>) {
    return {
      executable: '/definitely/not/a/real/hotclip-binary',
      videoPath: '/videos/synthetic.mp4',
      timeoutMs: 1_000,
      spawnImpl: vi.fn(),
      ...overrides,
    } as never;
  }

  it('rejects a missing executable with executable_missing and never spawns', async () => {
    const spawnImpl = vi.fn();
    await expect(
      runHotClipHighlights(baseOptions({ executable: '   ', spawnImpl })),
    ).rejects.toMatchObject({ code: 'executable_missing' });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('rejects out-of-bounds maxClips with invalid_options', async () => {
    for (const maxClips of [0, -1, 1.5, HOTCLIP_MAX_CLIPS + 1]) {
      await expect(
        runHotClipHighlights(baseOptions({ maxClips })),
      ).rejects.toMatchObject({ code: 'invalid_options' });
    }
    expect(HOTCLIP_MIN_CLIPS).toBe(1);
    expect(HOTCLIP_MAX_CLIPS).toBe(12);
  });

  it('rejects invalid timeoutMs / maxOutputBytes / killGraceMs', async () => {
    for (const timeoutMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        runHotClipHighlights(baseOptions({ timeoutMs })),
      ).rejects.toMatchObject({ code: 'invalid_options' });
    }
    await expect(
      runHotClipHighlights(baseOptions({ maxOutputBytes: 0 })),
    ).rejects.toMatchObject({ code: 'invalid_options' });
    await expect(
      runHotClipHighlights(baseOptions({ killGraceMs: -1 })),
    ).rejects.toMatchObject({ code: 'invalid_options' });
  });

  it('rejects empty videoPath and blank subtitlesPath', async () => {
    await expect(
      runHotClipHighlights(baseOptions({ videoPath: '' })),
    ).rejects.toMatchObject({ code: 'invalid_options' });
    await expect(
      runHotClipHighlights(baseOptions({ subtitlesPath: '   ' })),
    ).rejects.toMatchObject({ code: 'invalid_options' });
  });

  it('refuses code-injection env keys and non-string env values', async () => {
    await expect(
      runHotClipHighlights(baseOptions({ env: { NODE_OPTIONS: '--inspect' } })),
    ).rejects.toMatchObject({ code: 'invalid_options' });
    await expect(
      runHotClipHighlights(baseOptions({ env: { LD_PRELOAD: '/tmp/evil.so' } })),
    ).rejects.toMatchObject({ code: 'invalid_options' });
    await expect(
      runHotClipHighlights(baseOptions({ env: { HOTCLIP_LLM_MODEL: 42 as unknown as string } })),
    ).rejects.toMatchObject({ code: 'invalid_options' });
  });

  it('rejects an already-aborted signal with cancelled and never spawns', async () => {
    const spawnImpl = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runHotClipHighlights(baseOptions({ signal: controller.signal, spawnImpl })),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});

// ——————————————————————————————— 集成：真实假子进程 ———————————————————————————————

describe('runHotClipHighlights with a local fake child process', () => {
  it('returns validated candidates with exact ms conversion on exit 0', async () => {
    const candidates = await runFakeChild({
      instruction: { mode: 'valid', candidates: [VALID_CANDIDATE] },
      timeoutMs: 20_000,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: 'clip-1',
      startSec: 12.345,
      endSec: 60.5,
      startMs: 12_345,
      endMs: 60_500,
      recommended: true,
    });
  });

  it('maps empty stdout with exit 0 to [] (zero-candidate negatives preserved)', async () => {
    await expect(
      runFakeChild({ instruction: { mode: 'empty-stdout' }, timeoutMs: 20_000 }),
    ).resolves.toEqual([]);
    await expect(
      runFakeChild({ instruction: { mode: 'whitespace-stdout' }, timeoutMs: 20_000 }),
    ).resolves.toEqual([]);
    await expect(
      runFakeChild({ instruction: { mode: 'empty-array' }, timeoutMs: 20_000 }),
    ).resolves.toEqual([]);
  });

  it('rejects malformed and non-array JSON with invalid_output', async () => {
    await expect(
      runFakeChild({ instruction: { mode: 'malformed-json' }, timeoutMs: 20_000 }),
    ).rejects.toMatchObject({ code: 'invalid_output' });
    await expect(
      runFakeChild({ instruction: { mode: 'non-array' }, timeoutMs: 20_000 }),
    ).rejects.toMatchObject({ code: 'invalid_output' });
  });

  it('rejects invalid candidate times end-to-end and produces no candidates', async () => {
    const promise = runFakeChild({
      instruction: {
        mode: 'bad-times',
        candidates: [{ ...VALID_CANDIDATE, startSec: 30, endSec: 29 }],
      },
      timeoutMs: 20_000,
    });
    await expect(promise).rejects.toMatchObject({ code: 'invalid_output' });
    await expect(promise).rejects.toBeInstanceOf(HotClipSidecarError);
  });

  it('rejects nonzero exit with nonzero_exit and keeps stderr out of the error', async () => {
    const dir = makeTmpDir('hotclip-sidecar-secret-');
    plantSecretEnv('LINGJI_TEST_SECRET_MARKER', 'sk-super-secret-token-value');
    const videoPath = path.join(dir, 'SECRET-PATH-recording.mp4');
    let caught: unknown;
    try {
      await runFakeChild({
        instruction: {
          mode: 'exit-nonzero',
          exitCode: 3,
          stderr: 'RAW-STDERR-SECRET-marker sk-super-secret-token-value',
        },
        videoPath,
        timeoutMs: 20_000,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HotClipSidecarError);
    expect(caught).toMatchObject({ code: 'nonzero_exit', exitCode: 3 });
    const haystack = errorHaystack(caught);
    expect(haystack).not.toContain('RAW-STDERR-SECRET-marker');
    expect(haystack).not.toContain('sk-super-secret-token-value');
    expect(haystack).not.toContain('SECRET-PATH-recording.mp4');
    expect(haystack).not.toContain(dir);
  });

  it('enforces the stdout byte bound and reports output_too_large', async () => {
    await expect(
      runFakeChild({
        instruction: { mode: 'oversized', bytes: 64 * 1024 },
        maxOutputBytes: 1_024,
        timeoutMs: 20_000,
      }),
    ).rejects.toMatchObject({ code: 'output_too_large' });
  });

  it('enforces the stderr byte bound and reports output_too_large', async () => {
    await expect(
      runFakeChild({
        instruction: { mode: 'oversized-stderr', bytes: 64 * 1024 },
        maxOutputBytes: 1_024,
        timeoutMs: 20_000,
      }),
    ).rejects.toMatchObject({ code: 'output_too_large' });
  });

  it('rejects a missing executable (ENOENT) without leaking the path', async () => {
    let caught: unknown;
    try {
      await runHotClipHighlights({
        executable: path.join(makeTmpDir('hotclip-missing-'), 'no-such-hotclip-binary'),
        videoPath: '/videos/synthetic.mp4',
        timeoutMs: 20_000,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HotClipSidecarError);
    expect(caught).toMatchObject({ code: 'executable_missing' });
    expect(errorHaystack(caught)).not.toContain('no-such-hotclip-binary');
  });

  it(
    'kills the child on timeout, rejects once with timeout, leaves no orphan',
    async () => {
      const dir = makeTmpDir('hotclip-sidecar-timeout-');
      const scriptPath = writeFakeChildScript(dir);
      const probeFile = path.join(dir, 'probe.json');
      const promise = runHotClipHighlights({
        executable: process.execPath,
        argsPrefix: [scriptPath],
        cwd: dir,
        videoPath: path.join(dir, 'synthetic.mp4'),
        timeoutMs: 2_500,
        killGraceMs: 500,
        env: { FAKE_INSTRUCTION: JSON.stringify({ mode: 'sleep', probeFile }) },
      });
      // 立即挂接拒绝处理器：慢速主机上拒绝可能先于等待逻辑发生。
      const caught = promise.then(
        () => null,
        (error: unknown) => error,
      );
      expect(await waitForFile(probeFile, 10_000)).toBe(true);
      const error = await caught;
      expect(error).toBeInstanceOf(HotClipSidecarError);
      expect(error).toMatchObject({ code: 'timeout' });
      const probe = JSON.parse(fs.readFileSync(probeFile, 'utf8')) as { pid: number };
      expect(await waitForPidGone(probe.pid)).toBe(true);
    },
    { timeout: 60_000 },
  );

  it(
    'escalates to SIGKILL when the child ignores SIGTERM',
    async () => {
      const dir = makeTmpDir('hotclip-sidecar-escalate-');
      const scriptPath = writeFakeChildScript(dir);
      const probeFile = path.join(dir, 'probe.json');
      const promise = runHotClipHighlights({
        executable: process.execPath,
        argsPrefix: [scriptPath],
        cwd: dir,
        videoPath: path.join(dir, 'synthetic.mp4'),
        timeoutMs: 2_000,
        killGraceMs: 500,
        env: { FAKE_INSTRUCTION: JSON.stringify({ mode: 'ignore-terms', probeFile }) },
      });
      const caught = promise.then(
        () => null,
        (error: unknown) => error,
      );
      expect(await waitForFile(probeFile, 10_000)).toBe(true);
      expect(await caught).toMatchObject({ code: 'timeout' });
      const probe = JSON.parse(fs.readFileSync(probeFile, 'utf8')) as { pid: number };
      expect(await waitForPidGone(probe.pid)).toBe(true);
    },
    { timeout: 60_000 },
  );

  it(
    'kills the whole process group: no orphaned grandchild after timeout',
    async () => {
      const dir = makeTmpDir('hotclip-sidecar-group-');
      const scriptPath = writeFakeChildScript(dir);
      const probeFile = path.join(dir, 'probe.json');
      const promise = runHotClipHighlights({
        executable: process.execPath,
        argsPrefix: [scriptPath],
        cwd: dir,
        videoPath: path.join(dir, 'synthetic.mp4'),
        timeoutMs: 2_500,
        killGraceMs: 500,
        env: { FAKE_INSTRUCTION: JSON.stringify({ mode: 'grandchild', probeFile }) },
      });
      const caught = promise.then(
        () => null,
        (error: unknown) => error,
      );
      expect(await waitForFile(probeFile, 10_000)).toBe(true);
      // 等孙进程 pid 写入（probe 会被二次覆写）。
      let probe: { pid?: number; grandchildPid?: number } = {};
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        try {
          probe = JSON.parse(fs.readFileSync(probeFile, 'utf8')) as typeof probe;
        } catch {
          // probe 文件可能正被原子替换；重试直到超时。
        }
        if (typeof probe.grandchildPid === 'number') break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await caught).toMatchObject({ code: 'timeout' });
      expect(typeof probe.pid).toBe('number');
      expect(typeof probe.grandchildPid).toBe('number');
      expect(await waitForPidGone(probe.pid as number)).toBe(true);
      expect(await waitForPidGone(probe.grandchildPid as number)).toBe(true);
    },
    { timeout: 60_000 },
  );

  it(
    'kills the child on abort and rejects with cancelled',
    async () => {
      const dir = makeTmpDir('hotclip-sidecar-abort-');
      const scriptPath = writeFakeChildScript(dir);
      const probeFile = path.join(dir, 'probe.json');
      const controller = new AbortController();
      const promise = runHotClipHighlights({
        executable: process.execPath,
        argsPrefix: [scriptPath],
        cwd: dir,
        videoPath: path.join(dir, 'synthetic.mp4'),
        timeoutMs: 60_000,
        killGraceMs: 500,
        signal: controller.signal,
        env: { FAKE_INSTRUCTION: JSON.stringify({ mode: 'sleep', probeFile }) },
      });
      const caught = promise.then(
        () => null,
        (error: unknown) => error,
      );
      expect(await waitForFile(probeFile, 10_000)).toBe(true);
      controller.abort();
      const error = await caught;
      expect(error).toBeInstanceOf(HotClipSidecarError);
      expect(error).toMatchObject({ code: 'cancelled' });
      const probe = JSON.parse(fs.readFileSync(probeFile, 'utf8')) as { pid: number };
      expect(await waitForPidGone(probe.pid)).toBe(true);
    },
    { timeout: 60_000 },
  );

  it(
    'terminates the real child and rejects cancelled when abort fires inside spawn',
    async () => {
      const dir = makeTmpDir('hotclip-sidecar-abort-race-');
      const scriptPath = writeFakeChildScript(dir);
      const probeFile = path.join(dir, 'probe.json');
      const controller = new AbortController();
      let childPid: number | undefined;
      const spawnImpl = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        const child = nodeSpawn(command, args, options as never);
        if (childPid === undefined && command === process.execPath) childPid = child.pid ?? undefined;
        controller.abort();
        return child;
      }) as never;
      const promise = runHotClipHighlights({
        executable: process.execPath,
        argsPrefix: [scriptPath],
        cwd: dir,
        videoPath: path.join(dir, 'synthetic.mp4'),
        timeoutMs: 5_000,
        killGraceMs: 500,
        signal: controller.signal,
        spawnImpl,
        env: { FAKE_INSTRUCTION: JSON.stringify({ mode: 'sleep', probeFile }) },
      });
      const caught = promise.then(
        () => null,
        (error: unknown) => error,
      );
      const error = await caught;
      expect(error).toBeInstanceOf(HotClipSidecarError);
      expect(error).toMatchObject({ code: 'cancelled' });
      expect(typeof childPid).toBe('number');
      expect(await waitForPidGone(childPid as number)).toBe(true);
    },
    { timeout: 60_000 },
  );

  it('builds upstream argv, respects cwd, and forwards only approved env', async () => {
    plantSecretEnv('LINGJI_TEST_SECRET_MARKER', 'sk-super-secret-token-value');
    plantSecretEnv('NODE_OPTIONS', '--max-old-space-size=128');
    const runDir = makeTmpDir('hotclip-sidecar-cwd-');
    const probeDir = makeTmpDir('hotclip-sidecar-probe-');
    const scriptPath = writeFakeChildScript(probeDir);
    const probeFile = path.join(probeDir, 'probe.json');
    const videoPath = path.join(runDir, 'synthetic.mp4');
    const srtPath = path.join(runDir, 'synthetic.srt');

    const candidates = await runHotClipHighlights({
      executable: process.execPath,
      argsPrefix: [scriptPath],
      cwd: runDir,
      videoPath,
      subtitlesPath: srtPath,
      maxClips: 5,
      timeoutMs: 20_000,
      env: {
        FAKE_INSTRUCTION: JSON.stringify({ mode: 'probe', probeFile }),
        HOTCLIP_LLM_MODEL: 'caller-approved-model',
      },
    });
    expect(candidates).toEqual([]);

    expect(await waitForFile(probeFile, 5_000)).toBe(true);
    const probe = JSON.parse(fs.readFileSync(probeFile, 'utf8')) as {
      argv: string[];
      cwd: string;
      env: Record<string, string | undefined>;
    };
    expect(probe.argv).toEqual([
      'highlights',
      videoPath,
      '--json',
      '--subtitles',
      srtPath,
      '--max-clips',
      '5',
    ]);
    const expectedCwd = fs.realpathSync(runDir);
    if (process.platform === 'win32') {
      expect(probe.cwd.toLowerCase()).toBe(expectedCwd.toLowerCase());
    } else {
      expect(probe.cwd).toBe(expectedCwd);
    }
    expect(probe.env.FAKE_INSTRUCTION).toContain('"mode":"probe"');
    expect(probe.env.HOTCLIP_LLM_MODEL).toBe('caller-approved-model');
    expect(probe.env.LINGJI_TEST_SECRET_MARKER).toBeUndefined();
    expect(probe.env.NODE_OPTIONS).toBeUndefined();
  });

  it('omits subtitles/max-clips flags when not configured', async () => {
    const probeDir = makeTmpDir('hotclip-sidecar-probe2-');
    const scriptPath = writeFakeChildScript(probeDir);
    const probeFile = path.join(probeDir, 'probe.json');
    const videoPath = path.join(probeDir, 'synthetic.mp4');
    await runHotClipHighlights({
      executable: process.execPath,
      argsPrefix: [scriptPath],
      cwd: probeDir,
      videoPath,
      timeoutMs: 20_000,
      env: { FAKE_INSTRUCTION: JSON.stringify({ mode: 'probe', probeFile }) },
    });
    const probe = JSON.parse(fs.readFileSync(probeFile, 'utf8')) as { argv: string[] };
    expect(probe.argv).toEqual(['highlights', videoPath, '--json']);
  });

  it('does not forward parent PATH or app secrets when inheritBaseEnv is false', async () => {
    plantSecretEnv('LINGJI_TEST_SECRET_MARKER', 'sk-super-secret-token-value');
    const parentPath = process.env.PATH ?? '';
    const probeDir = makeTmpDir('hotclip-sidecar-noenv-');
    const scriptPath = writeFakeChildScript(probeDir);
    const probeFile = path.join(probeDir, 'probe.json');
    await runHotClipHighlights({
      executable: process.execPath,
      argsPrefix: [scriptPath],
      cwd: probeDir,
      videoPath: path.join(probeDir, 'synthetic.mp4'),
      timeoutMs: 20_000,
      inheritBaseEnv: false,
      env: { FAKE_INSTRUCTION: JSON.stringify({ mode: 'probe', probeFile }) },
    });
    const probe = JSON.parse(fs.readFileSync(probeFile, 'utf8')) as {
      env: Record<string, string | undefined>;
    };
    expect(probe.env.FAKE_INSTRUCTION).toBeDefined();
    expect(probe.env.LINGJI_TEST_SECRET_MARKER).toBeUndefined();
    if (process.platform === 'win32') {
      // Windows/libuv 在 env 缺 PATH 时会自动补全父进程 PATH（本机实测），
      // 适配器显式置空 PATH 以阻断；详见 docs/validation/p0-3-hotclip-pilot.md。
      expect(probe.env.PATH).toBe('');
    } else {
      expect(probe.env.PATH).toBeUndefined();
    }
    if (parentPath !== '') {
      expect(probe.env.PATH ?? '').not.toContain(parentPath);
    }
  });
});

// ——————————————————————————————— 注入 spawn：平台终止路径 ———————————————————————————————

interface FakeChildHandle extends EventEmitter {
  pid: number | undefined;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
  exitCode: number | null;
  signalCode: string | null;
}

function makeFakeChild(pid: number | undefined): FakeChildHandle {
  const emitter = new EventEmitter() as FakeChildHandle;
  emitter.pid = pid;
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.kill = vi.fn(() => true);
  emitter.unref = vi.fn();
  emitter.exitCode = null;
  emitter.signalCode = null;
  return emitter;
}

describe('platform termination behavior (injected spawn)', () => {
  it('spawns with shell:false, detached process group on POSIX, and fixed kill argv on win32', async () => {
    const calls: Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }> = [];

    // POSIX：验证 detached + shell:false。
    const posixChild = makeFakeChild(4321);
    const posixSpawn = vi.fn((command: string, args: readonly string[], options: Record<string, unknown>) => {
      calls.push({ command, args, options });
      return posixChild as unknown as ChildProcess;
    });
    const posixRun = runHotClipHighlights({
      executable: '/usr/local/bin/pnpm',
      argsPrefix: ['cli'],
      videoPath: '/videos/synthetic.mp4',
      timeoutMs: 5_000,
      platform: 'linux',
      spawnImpl: posixSpawn as never,
    });
    posixChild.stdout.end(Buffer.from('[]'));
    posixChild.emit('close', 0, null);
    await expect(posixRun).resolves.toEqual([]);
    expect(calls[0]?.command).toBe('/usr/local/bin/pnpm');
    expect(calls[0]?.args).toEqual(['cli', 'highlights', '/videos/synthetic.mp4', '--json']);
    expect(calls[0]?.options).toMatchObject({ shell: false, detached: true });

    // win32：超时后必须用固定 argv 的 taskkill /PID <pid> /T /F（无 shell）。
    calls.length = 0;
    const winChild = makeFakeChild(8642);
    const winSpawn = vi.fn((command: string, args: readonly string[], options: Record<string, unknown>) => {
      calls.push({ command, args, options });
      if (command === 'taskkill') {
        const killer = makeFakeChild(undefined);
        setTimeout(() => {
          winChild.signalCode = 'SIGKILL';
          winChild.emit('close', null, 'SIGKILL');
        }, 0);
        return killer as unknown as ChildProcess;
      }
      return winChild as unknown as ChildProcess;
    });
    const winRun = runHotClipHighlights({
      executable: 'C:\\tools\\hotclip\\hotclip.cmd',
      videoPath: 'C:\\videos\\synthetic.mp4',
      timeoutMs: 50,
      killGraceMs: 1_000,
      platform: 'win32',
      spawnImpl: winSpawn as never,
    });
    await expect(winRun).rejects.toMatchObject({ code: 'timeout' });
    expect(calls[0]?.options).toMatchObject({ shell: false, windowsHide: true });
    expect(calls[0]?.options?.detached).toBeFalsy();
    expect(calls[1]?.command).toBe('taskkill');
    expect(calls[1]?.args).toEqual(['/PID', '8642', '/T', '/F']);
    expect(calls[1]?.options).toMatchObject({ shell: false });
  });

  it('uses the documented default output bound when unset', () => {
    expect(DEFAULT_MAX_OUTPUT_BYTES).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_MAX_OUTPUT_BYTES)).toBe(true);
  });

  it('treats an abort raised synchronously inside spawn as cancelled and requests termination', async () => {
    const controller = new AbortController();
    const child = makeFakeChild(24_680);
    const calls: Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }> = [];
    const spawnImpl = vi.fn((command: string, args: readonly string[], options: Record<string, unknown>) => {
      calls.push({ command, args, options });
      if (command === 'taskkill') return makeFakeChild(undefined) as unknown as ChildProcess;
      // spawnFn 在返回句柄前同步触发 abort：取消事件早于适配器挂监听器。
      controller.abort();
      return child as unknown as ChildProcess;
    });

    const promise = runHotClipHighlights({
      executable: 'C:\\tools\\hotclip\\hotclip.cmd',
      videoPath: 'C:\\videos\\synthetic.mp4',
      timeoutMs: 3_000,
      killGraceMs: 100,
      signal: controller.signal,
      platform: 'win32',
      spawnImpl: spawnImpl as never,
    });
    const caught = promise.then(
      () => null,
      (error: unknown) => error,
    );
    const error = await caught;
    expect(error).toBeInstanceOf(HotClipSidecarError);
    expect(error).toMatchObject({ code: 'cancelled' });
    // 第一次是子进程，第二次必须是取消触发的 taskkill 树终止。
    expect(calls.map((call) => call.command)).toEqual(['C:\\tools\\hotclip\\hotclip.cmd', 'taskkill']);
    expect(calls[1]?.args).toEqual(['/PID', '24680', '/T', '/F']);
    expect(calls[1]?.options).toMatchObject({ shell: false, windowsHide: true });
    // close 未到达时的有界 SIGKILL 升级恰好一次，且不再重复 settle。
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
