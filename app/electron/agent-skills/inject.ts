/**
 * 纯函数：renderer 与 main 共用（无 Node API 依赖，可安全 import 进 renderer）。
 */

/** 从文本里提取 $skill-id token，去重保序。 */
export function parseSkillTokens(text: string): string[] {
  const matches = String(text ?? '').match(/\$([a-z0-9][a-z0-9-]*)/gi) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const id = raw.slice(1);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export interface InjectedSkill {
  id: string;
  markdown: string;
}

/** 把若干 SKILL.md 拼到用户消息之前（progressive disclosure：只注入主文件）。 */
export function buildInjectionText(skills: InjectedSkill[], userText: string): string {
  const header = [
    'The user explicitly invoked these skills:',
    ...skills.map((s) => `$${s.id}`),
    '',
    'Follow the SKILL.md instructions below. Load referenced files only when needed.',
  ].join('\n');
  const bodies = skills
    .map((s) => `--- skill: ${s.id} ---\n${s.markdown}\n--- end skill ---`)
    .join('\n\n');
  return `${header}\n\n${bodies}\n\nUser message:\n${userText}`;
}
