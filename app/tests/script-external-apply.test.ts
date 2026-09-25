import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScriptStore } from '../src/store/script';

/**
 * Task 12：外部直接改 script.md / original.md → 灌回工作台 store + 补建版本历史。
 * 验证 applyExternalScriptFile：
 *  - script 灌回更新 scriptText，并通过 scriptHistoryAPI.create 补建一个版本；
 *  - 相同内容重复灌回不再补建版本（防回环）；
 *  - original 灌回更新 originalText，且不创建版本。
 */
describe('applyExternalScriptFile（外部脚本变更灌回）', () => {
  const createSpy = vi.fn().mockResolvedValue({
    id: 1,
    fileName: 'script.md',
    source: 'external',
    providerName: null,
    modelName: null,
    label: null,
    byteSize: 0,
    createdAt: new Date().toISOString(),
  });

  beforeEach(() => {
    createSpy.mockClear();
    vi.stubGlobal('window', {
      scriptHistoryAPI: { create: createSpy },
    });
    // 预置初态：已打开某项目目录，初始正文为空
    useScriptStore.setState({
      projectDir: '/tmp/external-apply-project',
      scriptText: '',
      originalText: '',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('script 灌回后 store 正文等于新内容', () => {
    useScriptStore.getState().applyExternalScriptFile('script', '# 外部改写\n你好');
    expect(useScriptStore.getState().scriptText).toBe('# 外部改写\n你好');
  });

  it('script 灌回后补建一个版本（version +1）', () => {
    useScriptStore.getState().applyExternalScriptFile('script', '外部内容 A');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: '/tmp/external-apply-project',
        fileName: 'script.md',
        content: '外部内容 A',
        source: 'external',
      }),
    );
  });

  it('相同内容重复灌回不新增版本（防回环）', () => {
    useScriptStore.setState({ scriptText: '一致的内容' });
    useScriptStore.getState().applyExternalScriptFile('script', '一致的内容');
    expect(createSpy).not.toHaveBeenCalled();
    expect(useScriptStore.getState().scriptText).toBe('一致的内容');
  });

  it('original 灌回更新 originalText 且不创建版本', () => {
    useScriptStore.getState().applyExternalScriptFile('original', '原始素材外部改动');
    expect(useScriptStore.getState().originalText).toBe('原始素材外部改动');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('original 相同内容重复灌回直接返回（防回环）', () => {
    useScriptStore.setState({ originalText: '同样' });
    useScriptStore.getState().applyExternalScriptFile('original', '同样');
    expect(useScriptStore.getState().originalText).toBe('同样');
  });

  it('无 projectDir 时仍更新正文但不创建版本', () => {
    useScriptStore.setState({ projectDir: null, scriptText: '' });
    useScriptStore.getState().applyExternalScriptFile('script', '无项目目录内容');
    expect(useScriptStore.getState().scriptText).toBe('无项目目录内容');
    expect(createSpy).not.toHaveBeenCalled();
  });
});
