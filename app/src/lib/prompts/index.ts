export {
  PROMPT_KINDS,
  PROMPT_KIND_META,
  PROMPT_CATEGORIES,
  PROMPT_CATEGORY_META,
  isPromptKind,
  isPromptCategory,
  userPromptBindingKey,
  parseUserPromptBindingKey,
  type PromptKind,
  type PromptKindMeta,
  type PromptCategory,
  type PromptCategoryMeta,
  type PromptGroup,
  type PromptScope,
  type PromptTemplate,
  type EffectivePromptTemplate,
  type LockedContract,
  type UserPromptEntry,
  type UserPromptSeed,
} from './types';
export { DEFAULT_PROMPT_YAML } from './defaults';
export { SCRIPT_TEMPLATE_SEEDS, getScriptTemplateSeedById } from './script-template-defaults';
export {
  renderTemplate,
  renderUserPromptWithLock,
  parsePromptYaml,
  serializePromptYaml,
  createPromptYamlFromUserText,
  parseUserPromptYaml,
  serializeUserPromptYaml,
  type UserPromptYamlBody,
} from './render';

import { DEFAULT_PROMPT_YAML } from './defaults';
import { parsePromptYaml } from './render';
import type { PromptKind, PromptTemplate } from './types';

const builtinCache = new Map<PromptKind, PromptTemplate>();

export function getBuiltinPromptTemplate(kind: PromptKind): PromptTemplate {
  const cached = builtinCache.get(kind);
  if (cached) return cached;
  const { template } = parsePromptYaml(DEFAULT_PROMPT_YAML[kind], kind);
  builtinCache.set(kind, template);
  return template;
}
