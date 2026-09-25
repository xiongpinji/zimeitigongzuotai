import { describe, expect, it } from 'vitest';
import { resolvePreferredAgentType } from '../src/lib/agent-api';
import type { AgentConfigData } from '../electron/acp/types';

describe('resolvePreferredAgentType (global single active)', () => {
  it('returns config.activeAgentId', () => {
    const config = { activeAgentId: 'codex', agents: {}, permissionPolicy: 'tiered' } as AgentConfigData;
    expect(resolvePreferredAgentType(config)).toBe('codex');
  });

  it('falls back to claude when activeAgentId missing', () => {
    const config = { agents: {}, permissionPolicy: 'tiered' } as AgentConfigData;
    expect(resolvePreferredAgentType(config)).toBe('claude');
  });

  it('falls back to claude when config is null/undefined', () => {
    expect(resolvePreferredAgentType(null)).toBe('claude');
    expect(resolvePreferredAgentType(undefined)).toBe('claude');
  });

  it('ignores enabled/sortOrder (no longer used)', () => {
    // 即便 codex 被标记 enabled 且 sortOrder 更小，激活仍由 activeAgentId 决定
    const config = {
      activeAgentId: 'claude',
      permissionPolicy: 'tiered',
      agents: {
        codex: { enabled: true, sortOrder: 0 } as never,
        claude: { enabled: false, sortOrder: 9 } as never,
      },
    } as AgentConfigData;
    expect(resolvePreferredAgentType(config)).toBe('claude');
  });
});
