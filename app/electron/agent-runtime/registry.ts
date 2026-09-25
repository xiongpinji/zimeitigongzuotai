import type { RuntimeAgentDef } from './types';
import { piAgentDef } from './agent-defs/pi';

export const AGENT_DEFS: RuntimeAgentDef[] = [piAgentDef];

(function validateUniqueness() {
  const seen = new Set<string>();
  for (const def of AGENT_DEFS) {
    if (seen.has(def.id)) throw new Error(`Duplicate agent def id: "${def.id}"`);
    seen.add(def.id);
  }
})();

export function getAgentDef(id: string): RuntimeAgentDef | null {
  return AGENT_DEFS.find((def) => def.id === id) ?? null;
}
export function listAgentDefs(): RuntimeAgentDef[] {
  return AGENT_DEFS;
}
