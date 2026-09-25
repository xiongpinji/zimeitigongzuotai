/**
 * 组装 HandlerContext。提供内存实现的默认依赖，可被运行时（chrome 存储/下载等）
 * 或测试（注入 fake services / 页面 URL）覆盖。
 */
import { createMemoryRepository, type Repository } from './repository';
import { createMemorySettingsStore, type SettingsStore } from './settings-store';
import { createStubServices, type Services } from './services';
import type { BridgeContext, HandlerContext } from './handlers';
import { createMemoryBridgeSettingsStore } from '@/bridge/bridge-settings';
import type { FetchText } from '@/resolver/share-resolver';

export interface InMemoryContextOverrides {
  now?: () => number;
  newId?: () => string;
  getActivePageUrl?: () => Promise<string | null>;
  fetchPage?: FetchText;
  services?: Partial<Services>;
  settings?: SettingsStore;
  repo?: Repository;
  bridge?: BridgeContext;
}

/** 默认桥依赖：内存设置 + 始终不可达的探活 + 未配置的推送（纯内存、不联网）。 */
function defaultBridge(): BridgeContext {
  return {
    settings: createMemoryBridgeSettingsStore(),
    client: {
      async probe() { return { ok: false }; },
      async pair() { return { ok: false }; },
    },
    async push() { return { pushed: false, reason: 'disabled' }; },
  };
}

function defaultIdGen(): () => string {
  let seq = 0;
  return () => {
    seq += 1;
    return `sonar-${seq.toString(36)}`;
  };
}

export function createInMemoryContext(overrides: InMemoryContextOverrides = {}): HandlerContext {
  const now = overrides.now ?? (() => Date.now());
  const newId = overrides.newId ?? defaultIdGen();
  const repo = overrides.repo ?? createMemoryRepository({ now, newId });
  const settings = overrides.settings ?? createMemorySettingsStore();
  const services: Services = { ...createStubServices(), ...overrides.services };
  const getActivePageUrl = overrides.getActivePageUrl ?? (async () => null);
  // 默认不联网：返回空文本 → 分享页解析得到 null，保持纯内存行为；测试可注入 fetchPage。
  const fetchPage = overrides.fetchPage ?? (async (url: string) => ({ text: '', finalUrl: url }));
  const bridge = overrides.bridge ?? defaultBridge();
  return { repo, settings, services, getActivePageUrl, fetchPage, now, newId, bridge };
}
