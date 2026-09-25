/**
 * agent-presentation.ts
 *
 * Renderer 侧 agent 展示元数据。
 *
 * 当前 runtime 只包含 pi；agent 列表 / 名称从
 * `electron/agent-runtime/registry` 的 `listAgentDefs()` 取（纯数据，renderer 可安全 import）。
 *
 * 设置页除了 id/name 还需要一些「展示 / 安装策略」字段（是否托管、是否需要 API Key、
 * 安装指引等），这些不在 `RuntimeAgentDef` 上。这里按新 id 维护一份 renderer 镜像常量，
 * 与 runtime def 合并成 `AgentPresentation`。
 */

import type { AgentModel } from '../../electron/agent-runtime/types';
import { listAgentDefs } from '../../electron/agent-runtime/registry';

/** 默认 agent id（pi）。 */
export const DEFAULT_AGENT_ID = 'pi';

/** Renderer 侧 agent 展示 / 安装策略元数据（不在 RuntimeAgentDef 上的部分）。 */
interface AgentUiMeta {
  /** 是否由本应用托管安装。 */
  managed: boolean;
  /** 需要注入的 API Key env 变量名；无则不显示凭证表单、不注入 key。 */
  apiKeyEnvVar?: string;
  /** 非托管 agent 所需的外部二进制名（用于展示提示）。 */
  requiredBinary?: string;
  /** 非托管 agent 的安装 / 凭证配置指引文案。 */
  installGuide?: string;
  /** 托管 agent 的默认版本（安装动作使用）。 */
  defaultVersion?: string;
}

/** 按 id 维护的展示元数据镜像（当前只有 pi）。 */
const AGENT_UI_META: Record<string, AgentUiMeta> = {
  pi: {
    managed: false,
    requiredBinary: 'pi',
    installGuide:
      'Pi 通过本地 `pi` CLI 启动，需先在系统安装 `pi` 命令并配置好模型 provider 凭证（见 https://pi.dev）。本应用不代管 pi 安装与凭证。',
  },
};

const DEFAULT_UI_META: AgentUiMeta = { managed: false };

export interface AgentPresentation extends AgentUiMeta {
  id: string;
  displayName: string;
  /** Static model list from runtime def, for UI model selectors. */
  models?: AgentModel[];
  /** Default model id (from runtime def). */
  defaultModel?: string;
  /** 思考程度可选项（为空表示该 agent 不支持思考程度切换）。 */
  reasoningOptions?: AgentModel[];
  /** 默认思考程度 id。 */
  defaultReasoning?: string;
}

function uiMetaFor(id: string): AgentUiMeta {
  return AGENT_UI_META[id] ?? DEFAULT_UI_META;
}

/** 列出所有 agent 的展示元数据（id / 名称来自 runtime registry）。 */
export function listAgentPresentations(): AgentPresentation[] {
  return listAgentDefs().map((def) => ({
    id: def.id,
    displayName: def.name,
    models: def.models,
    defaultModel: def.defaultModel,
    reasoningOptions: def.reasoningOptions,
    defaultReasoning: def.defaultReasoning,
    ...uiMetaFor(def.id),
  }));
}

/** 取单个 agent 的展示元数据；未知 id 回退到默认 agent（pi）。 */
export function getAgentPresentation(id: string | undefined | null): AgentPresentation {
  const defs = listAgentDefs();
  const def = (id ? defs.find((d) => d.id === id) : null) ?? defs.find((d) => d.id === DEFAULT_AGENT_ID) ?? defs[0];
  return {
    id: def.id,
    displayName: def.name,
    models: def.models,
    defaultModel: def.defaultModel,
    reasoningOptions: def.reasoningOptions,
    defaultReasoning: def.defaultReasoning,
    ...uiMetaFor(def.id),
  };
}
