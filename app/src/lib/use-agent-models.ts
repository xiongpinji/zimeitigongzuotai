/**
 * useAgentModels — 按 agentId 动态拉取可选模型列表。
 *
 * 背景：部分 agent（pi）的模型不是编译期静态已知，需要运行时跑
 * `pi --list-models` 才能拿到该机器上真实可用的 provider/model。本 hook：
 *
 *   - 初始值用 `getAgentPresentation(agentId).models`（静态兜底），保证
 *     非 electron 环境 / jsdom 测试 / 首屏渲染都不空。
 *   - 若 `window.agentAPI?.listModels` 存在，异步拉取并替换；失败保留兜底。
 *   - module-level 缓存（按 agentId），避免每次打开下拉都重拉。
 *
 * 与 open-design 的 InlineModelSwitcher 思路一致（live + fallback 两态）。
 */

import { useEffect, useState } from 'react';
import type { AgentModel } from '../../electron/agent-runtime/types';
import { getAgentPresentation } from './agent-presentation';

export interface UseAgentModelsResult {
  models: AgentModel[];
  loading: boolean;
  /** 'live'：CLI 实时拉取；'fallback'：静态兜底；'static'：尚未发起/无桥接。 */
  source: 'live' | 'fallback' | 'static';
}

interface CacheEntry {
  models: AgentModel[];
  source: 'live' | 'fallback';
}

// 按 agentId 缓存已拉取结果（live 或 fallback 都缓存，避免重复 IPC）。
const modelCache = new Map<string, CacheEntry>();

/** 测试辅助：清空缓存。 */
export function __clearAgentModelsCache(): void {
  modelCache.clear();
}

function staticModelsFor(agentId: string): AgentModel[] {
  return getAgentPresentation(agentId).models ?? [];
}

export function useAgentModels(agentId: string): UseAgentModelsResult {
  const cached = modelCache.get(agentId);
  const [state, setState] = useState<UseAgentModelsResult>(() =>
    cached
      ? { models: cached.models, loading: false, source: cached.source }
      : { models: staticModelsFor(agentId), loading: false, source: 'static' },
  );

  useEffect(() => {
    let cancelled = false;

    const cachedEntry = modelCache.get(agentId);
    if (cachedEntry) {
      setState({ models: cachedEntry.models, loading: false, source: cachedEntry.source });
      return;
    }

    const api = typeof window !== 'undefined' ? window.agentAPI : undefined;
    // 无桥接（jsdom / 非 electron）：保持静态兜底，不发起拉取。
    if (!api || typeof api.listModels !== 'function') {
      setState({ models: staticModelsFor(agentId), loading: false, source: 'static' });
      return;
    }

    setState({ models: staticModelsFor(agentId), loading: true, source: 'static' });
    void api
      .listModels(agentId)
      .then((res) => {
        if (cancelled) return;
        const models = res?.models?.length ? res.models : staticModelsFor(agentId);
        const source = res?.models?.length ? res.source : 'fallback';
        modelCache.set(agentId, { models, source });
        setState({ models, loading: false, source });
      })
      .catch(() => {
        if (cancelled) return;
        // 拉取失败：回退静态兜底（不缓存，下次可重试）。
        setState({ models: staticModelsFor(agentId), loading: false, source: 'fallback' });
      });

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  return state;
}
