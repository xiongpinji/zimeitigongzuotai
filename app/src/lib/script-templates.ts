// src/lib/script-templates.ts
//
// 口播模板的角色派生入口。迁移到提示词系统后，模板数据存储于
// AIStore 的 `userPromptEntries['script-template']`；本文件仅负责把模板列表
// 派生成"角色"（供 QuickActionBar 下拉使用），并合并自定义角色。

import { useAIStore } from '../store/ai';
import { SCRIPT_TEMPLATE_SEEDS } from './prompts/script-template-defaults';
import type { UserPromptEntry } from './prompts/types';
import { loadCustomRoles, NONE_ROLE, type ScriptRole } from './settings-storage';

/**
 * 从 AIStore 读取 `script-template` 分类条目；未 hydrate 时用 seeds 兜底。
 */
function readScriptTemplateEntries(): UserPromptEntry[] {
  const state = useAIStore.getState();
  const entries = state.userPromptEntries?.['script-template'] ?? [];
  if (entries.length > 0) return entries;
  return SCRIPT_TEMPLATE_SEEDS.map((seed) => ({
    id: seed.id,
    category: seed.category,
    name: seed.name,
    description: seed.description,
    version: seed.version,
    system: seed.system,
    user: seed.user,
    isBuiltin: true,
  }));
}

export function getAllRoles(): ScriptRole[] {
  const templateRoles: ScriptRole[] = readScriptTemplateEntries().map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    rolePrompt: entry.system,
    isBuiltin: entry.isBuiltin,
  }));
  const customs: ScriptRole[] = loadCustomRoles().map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    rolePrompt: r.rolePrompt,
    isBuiltin: false,
  }));
  return [NONE_ROLE, ...templateRoles, ...customs];
}

export function getRoleById(id: string): ScriptRole | undefined {
  return getAllRoles().find((r) => r.id === id);
}
