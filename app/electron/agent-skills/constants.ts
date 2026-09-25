import type { AgentSkillLoadMode } from '../acp/types';

/** 首期唯一内置 skill 的 id。 */
export const BUILTIN_SKILL_ID = 'lingji-video-workflow';

/** 内置 skill 子目录名（种子目录 / 用户配置目录下一致）。 */
export const AGENT_SKILLS_DIRNAME = 'agent-skills';

/**
 * 各 agent 的加载方式（配置中心展示 + runtime 行为依据）。
 * - pi：原生 --skill + $ 显式注入
 * - codex：--add-dir 目录访问 + $ 显式注入
 * - claude：CLAUDE.md 上下文引导 + $ 显式注入
 */
export const LOAD_MODES_BY_AGENT: Record<string, AgentSkillLoadMode[]> = {
  pi: ['native', 'prompt_injection'],
  codex: ['directory_access', 'prompt_injection'],
  claude: ['context_file', 'prompt_injection'],
};
