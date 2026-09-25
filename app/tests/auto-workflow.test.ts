import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useAIStore } from '../src/store/ai';
import type { WorkflowStep } from '../src/store/ai';
import type { AppPage } from '../src/lib/electron-api';
import { runScriptGenerating } from '../src/lib/auto-workflow';
import * as scriptUtils from '../src/lib/script-utils';

const electronAPIMock = {
  saveScriptFile: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  electronAPIMock.saveScriptFile.mockClear();
  (globalThis as unknown as { window: typeof globalThis }).window =
    globalThis as unknown as typeof globalThis;
  (globalThis as unknown as { window: { electronAPI: typeof electronAPIMock } }).window.electronAPI =
    electronAPIMock;
});

describe('WorkflowStep type extensions', () => {
  it('accepts script_generating and douyin_importing as valid steps', () => {
    const s1: WorkflowStep = 'script_generating';
    const s2: WorkflowStep = 'douyin_importing';
    expect(s1).toBe('script_generating');
    expect(s2).toBe('douyin_importing');
  });
});

describe('AIStore.pendingAutoParams', () => {
  it('starts null and accepts set/clear', () => {
    useAIStore.getState().setPendingAutoParams(null);
    expect(useAIStore.getState().pendingAutoParams).toBeNull();
    useAIStore
      .getState()
      .setPendingAutoParams({ templateId: 'news-broadcast', roleId: 'none', voiceId: 'female-shaonv' });
    expect(useAIStore.getState().pendingAutoParams?.voiceId).toBe('female-shaonv');
    useAIStore.getState().setPendingAutoParams(null);
    expect(useAIStore.getState().pendingAutoParams).toBeNull();
  });
});

describe('AppPage type extension', () => {
  it('accepts auto-run', () => {
    const p: AppPage = 'auto-run';
    expect(p).toBe('auto-run');
  });
});

describe('runScriptGenerating', () => {
  it('writes script.md and returns the generated text', async () => {
    vi.spyOn(scriptUtils, 'generateScriptDraft').mockResolvedValue('生成的口播稿');
    const result = await runScriptGenerating({
      originalText: '原始素材',
      projectDir: '/tmp/proj',
      params: { templateId: 'news-broadcast', roleId: 'none', voiceId: 'x' },
    });
    expect(result).toBe('生成的口播稿');
    expect(scriptUtils.generateScriptDraft).toHaveBeenCalledWith('原始素材', 'news-broadcast', 'none');
    expect(electronAPIMock.saveScriptFile).toHaveBeenCalledWith('/tmp/proj', 'script.md', '生成的口播稿');
  });

  it('throws when originalText is empty', async () => {
    await expect(
      runScriptGenerating({
        originalText: '   ',
        projectDir: '/tmp/proj',
        params: { templateId: 'x', roleId: 'none', voiceId: 'x' },
      }),
    ).rejects.toThrow('原始素材为空');
  });

  it('throws when projectDir is empty', async () => {
    await expect(
      runScriptGenerating({
        originalText: 'abc',
        projectDir: '',
        params: { templateId: 'x', roleId: 'none', voiceId: 'x' },
      }),
    ).rejects.toThrow('未选择项目目录');
  });
});

/**
 * useAIVideoWorkflow autoMode 接入校验
 *
 * 说明：完整渲染该 hook 需要 mock 大量依赖（loadAISettings、useTimelineStore、
 * 多个 electronAPI 方法、jsdom 环境等），与本任务投入产出不匹配。
 * 因此按 plan 的备注降级为「源码契约校验」：
 *   - WorkflowStartOptions 接受 autoMode/autoParams/originalText
 *   - start 在 autoMode=true 时 initialStep 设为 script_generating
 *   - runFromStep 内存在 script_generating 分支并调用 runScriptGenerating
 *   - TTS 调用处 voiceId 优先来自 autoParams.voiceId
 *   - PHASES 表新增 script 阶段、TOTAL_STEPS = 6
 * 端到端真实链路放到 Task 14 的手动 E2E 回归覆盖。
 */
describe('useAIVideoWorkflow autoMode wiring (source contract)', () => {
  const source = readFileSync(
    new URL('../src/hooks/useAIVideoWorkflow.ts', import.meta.url),
    'utf8',
  );

  it('imports runScriptGenerating and AutoWorkflowParams', () => {
    expect(source).toContain("import { runScriptGenerating } from '../lib/auto-workflow'");
    expect(source).toMatch(/import type \{ AutoWorkflowParams \} from '\.\.\/store\/ai'/);
  });

  it('extends WorkflowStartOptions with autoMode/autoParams/originalText/script_generating', () => {
    expect(source).toContain('autoMode?: boolean');
    expect(source).toContain('autoParams?: AutoWorkflowParams');
    expect(source).toContain('originalText?: string');
    expect(source).toMatch(/startFromStep\?:\s*Extract<\s*WorkflowStep,\s*'script_generating'\s*\|\s*'tts_generating'\s*\|\s*'ai_analyzing'\s*\|\s*'cover_generating'\s*\|\s*'arranging'\s*>/);
  });

  it('extends WorkflowSessionState with autoMode/autoParams/originalText fields', () => {
    expect(source).toMatch(/autoMode:\s*boolean/);
    expect(source).toMatch(/autoParams:\s*AutoWorkflowParams\s*\|\s*null/);
    expect(source).toMatch(/originalText:\s*string/);
  });

  it('updates PHASES to 6 steps with script phase', () => {
    expect(source).toContain('const TOTAL_STEPS = 6');
    expect(source).toMatch(/script:\s*\{[^}]*key:\s*'script'/);
    expect(source).toContain("category: 'ai-write'");
  });

  it('runFromStep contains script_generating branch that calls runScriptGenerating', () => {
    expect(source).toContain("if (fromStep === 'script_generating')");
    expect(source).toContain('await runScriptGenerating(');
  });

  it('start chooses script_generating when autoMode=true', () => {
    expect(source).toContain(
      "options?.startFromStep ?? (options?.autoMode ? 'script_generating' : 'tts_generating')",
    );
    expect(source).toContain('workflowSession.autoMode = options?.autoMode ?? false');
    expect(source).toContain('workflowSession.autoParams = options?.autoParams ?? null');
    expect(source).toContain("workflowSession.originalText = options?.originalText ?? ''");
  });

  it('TTS voiceId prefers autoParams.voiceId over the configured voice', () => {
    expect(source).toMatch(
      /voiceId:\s*workflowSession\.autoParams\?\.voiceId\s*&&\s*defaultTtsConfig\.voice\.providerType\s*===\s*'minimax'\s*\?\s*workflowSession\.autoParams\.voiceId\s*:\s*defaultTtsConfig\.voice\.voiceId/,
    );
  });

  it('runs subtitle highlights and cover generation in parallel after analysis', () => {
    expect(source).toContain('const highlightsTrack = (async (): Promise<void> => {');
    expect(source).toContain('const coverTrack = (async (): Promise<CoverCandidate[] | null> => {');
    expect(source).toContain('await coverPromptsReadyPromise');
    expect(source).toContain('const [, coverCandidatesResult] = await Promise.all([highlightsTrack, coverTrack])');
    expect(source).toContain('const postEnd = PHASES.arrange.baseStart');
    expect(source).toContain('refreshCombinedProgress');
  });

  it('arranges all AI cards in one timeline store update without artificial sleep', () => {
    expect(source).toContain('timelineStore.addAICardsToTimeline(drafts)');
    expect(source).not.toContain('await sleep(90)');
    expect(source).not.toContain('function sleep(ms: number)');
  });
});

describe('useAIVideoWorkflow autoMode (runtime smoke)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('runScriptGenerating uses autoParams.templateId/roleId for script.md generation', async () => {
    // 这里再做一次最小运行时校验：autoMode 提供的 templateId/roleId
    // 必须按原样传给 generateScriptDraft，与 hook 中调用一致。
    const spy = vi
      .spyOn(scriptUtils, 'generateScriptDraft')
      .mockResolvedValue('稿件内容');
    const saveScriptFile = vi.fn().mockResolvedValue(undefined);
    (globalThis as unknown as { window: typeof globalThis }).window =
      globalThis as unknown as typeof globalThis;
    (globalThis as unknown as { window: { electronAPI: { saveScriptFile: typeof saveScriptFile } } })
      .window.electronAPI = { saveScriptFile };

    const text = await runScriptGenerating({
      originalText: '原始素材',
      projectDir: '/tmp/proj',
      params: { templateId: 'news-broadcast', roleId: 'none', voiceId: 'female-shaonv' },
    });

    expect(text).toBe('稿件内容');
    expect(spy).toHaveBeenCalledWith('原始素材', 'news-broadcast', 'none');
    expect(saveScriptFile).toHaveBeenCalledWith('/tmp/proj', 'script.md', '稿件内容');
  });
});

describe('useAIVideoWorkflow autoMode guard fixes', () => {
  it('skips empty-scriptText guard for script_generating', async () => {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(
      new URL('../src/hooks/useAIVideoWorkflow.ts', import.meta.url),
      'utf-8',
    );
    expect(source).toContain("fromStep !== 'script_generating' && !scriptText.trim()");
  });

  it('extends MiniMax key pre-check to script_generating', async () => {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(
      new URL('../src/hooks/useAIVideoWorkflow.ts', import.meta.url),
      'utf-8',
    );
    expect(source).toContain("fromStep === 'tts_generating' || fromStep === 'script_generating'");
  });
});
