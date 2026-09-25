import { describe, it, expect } from 'vitest';
import { ensureDefaultAgents } from '../electron/acp/config';

describe('ensureDefaultAgents skills 默认', () => {
  it('为默认 pi 条目补默认 skill 配置', () => {
    const agents = ensureDefaultAgents({});
    expect(agents.pi.skills).toEqual([
      { id: 'lingji-video-workflow', enabled: true },
    ]);
  });

  it('不覆盖用户已有 skills 配置', () => {
    const agents = ensureDefaultAgents({
      pi: {
        enabled: true, authMode: 'subscription', apiKey: '', apiBaseUrl: '',
        model: '', envText: '', configJson: '', version: '', sortOrder: 0,
        skills: [{ id: 'lingji-video-workflow', enabled: false }],
      },
    });
    expect(agents.pi.skills).toEqual([
      { id: 'lingji-video-workflow', enabled: false },
    ]);
  });
});
