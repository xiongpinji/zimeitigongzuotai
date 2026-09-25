/**
 * tests/production-agent-action-gate.test.ts
 *
 * P4-1 第一段：九类生产动作 + 预授权活动门控的纯函数测试。
 * 第二轮定向修复新增：配额三字段（requestedJobs / usedQueuedJobs / maxQueuedJobs）
 * 的安全整数边界反例（Number.isInteger 会把 1e308 与 MAX_SAFE_INTEGER+1 当整数放行）。
 *
 * 全部使用合成输入：不读真实账号 / 凭证 / 素材 / 文件，不触网、不登录、不发布。
 * 被测实现：electron/production/agent-action-gate.ts（本轮仅纯门控，未接 MCP / IPC / Agent runtime）。
 */

import { describe, expect, it } from 'vitest';
import {
  AGENT_ACTION_GATE_DENIAL_CODES,
  AGENT_PRODUCTION_ACTIONS,
  evaluateAgentProductionAction,
  isAgentProductionAction,
} from '../electron/production/agent-action-gate';
import type {
  AgentActionGateContext,
  AgentActionGateDecision,
  AgentActionGateDenialCode,
  AgentProductionAction,
  ProductionActivityGrantV1,
  QueuePublishActionRequest,
} from '../electron/production/agent-action-gate';

const NOW = 1_800_000_000_000;
const PROJECT_ID = 'proj-p4-1-gate';

function makeGrant(overrides: Partial<ProductionActivityGrantV1> = {}): ProductionActivityGrantV1 {
  return {
    projectId: PROJECT_ID,
    issuedAtMs: NOW - 60_000,
    expiresAtMs: NOW + 3_600_000,
    allowedActions: [...AGENT_PRODUCTION_ACTIONS],
    accountIds: ['acct-douyin-1', 'acct-xhs-2'],
    platforms: ['douyin', 'xiaohongshu'],
    autoPublish: true,
    maxQueuedJobs: 5,
    ...overrides,
  };
}

function makeContext(overrides: Partial<AgentActionGateContext> = {}): AgentActionGateContext {
  return { nowMs: NOW, usedQueuedJobs: 0, ...overrides };
}

function makePublishRequest(overrides: Partial<QueuePublishActionRequest> = {}): QueuePublishActionRequest {
  return {
    action: 'queue_publish',
    projectId: PROJECT_ID,
    accountId: 'acct-douyin-1',
    platform: 'douyin',
    requestedJobs: 1,
    commerceRequest: null,
    ...overrides,
  };
}

function allow(request: unknown, grant: unknown = makeGrant(), context: unknown = makeContext()): AgentActionGateDecision {
  return evaluateAgentProductionAction(request, grant, context);
}

function expectAllowed(decision: AgentActionGateDecision): void {
  expect(decision).toEqual({ allowed: true });
}

function expectDenied(decision: AgentActionGateDecision, reason: AgentActionGateDenialCode): void {
  expect(decision).toEqual({ allowed: false, reason });
}

const NON_PUBLISH_ACTIONS = AGENT_PRODUCTION_ACTIONS.filter(
  (action): action is Exclude<AgentProductionAction, 'queue_publish'> => action !== 'queue_publish',
);

describe('九类动作与拒绝码稳定性', () => {
  it('恰好九类动作且顺序稳定、无重复', () => {
    expect(AGENT_PRODUCTION_ACTIONS).toEqual([
      'import_recordings',
      'detect_highlights',
      'adjust_highlights',
      'search_authorized_assets',
      'build_compositions',
      'edit_timeline',
      'render_variants',
      'quality_check',
      'queue_publish',
    ]);
    expect(AGENT_PRODUCTION_ACTIONS).toHaveLength(9);
    expect(new Set(AGENT_PRODUCTION_ACTIONS).size).toBe(9);
  });

  it('动作列表运行时冻结，不能被改写', () => {
    expect(Object.isFrozen(AGENT_PRODUCTION_ACTIONS)).toBe(true);
    expect(() => {
      (AGENT_PRODUCTION_ACTIONS as unknown as AgentProductionAction[]).push('queue_publish');
    }).toThrow();
    expect(AGENT_PRODUCTION_ACTIONS).toHaveLength(9);
  });

  it('isAgentProductionAction 只认九类动作', () => {
    for (const action of AGENT_PRODUCTION_ACTIONS) {
      expect(isAgentProductionAction(action)).toBe(true);
    }
    expect(isAgentProductionAction('publish_everything')).toBe(false);
    expect(isAgentProductionAction(8)).toBe(false);
    expect(isAgentProductionAction(null)).toBe(false);
    expect(isAgentProductionAction(undefined)).toBe(false);
  });

  it('拒绝码集合稳定、唯一且全部为小写机器码', () => {
    expect([...AGENT_ACTION_GATE_DENIAL_CODES]).toEqual([
      'request_invalid',
      'unknown_action',
      'grant_missing',
      'grant_invalid',
      'clock_invalid',
      'grant_not_yet_valid',
      'grant_expired',
      'project_mismatch',
      'action_not_allowed',
      'account_not_allowed',
      'platform_not_allowed',
      'auto_publish_disabled',
      'used_jobs_invalid',
      'publish_quota_exceeded',
      'commerce_not_supported',
    ]);
    expect(new Set(AGENT_ACTION_GATE_DENIAL_CODES).size).toBe(AGENT_ACTION_GATE_DENIAL_CODES.length);
    for (const code of AGENT_ACTION_GATE_DENIAL_CODES) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe('默认拒绝：活动授权', () => {
  it('缺 grant 一律拒绝', () => {
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, null), 'grant_missing');
    expectDenied(
      evaluateAgentProductionAction({ action: 'quality_check', projectId: PROJECT_ID }, undefined, makeContext()),
      'grant_missing',
    );
    expectDenied(allow(makePublishRequest(), null), 'grant_missing');
  });

  it('非法 grant 结构一律拒绝', () => {
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, 'not-a-grant'), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, []), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, {}), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ projectId: '' })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ projectId: '   ' })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ issuedAtMs: Number.NaN })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ expiresAtMs: Number.POSITIVE_INFINITY })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ issuedAtMs: NOW, expiresAtMs: NOW })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ issuedAtMs: NOW, expiresAtMs: NOW - 1 })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ allowedActions: 'queue_publish' as unknown as AgentProductionAction[] })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ allowedActions: ['not_an_action' as AgentProductionAction] })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ accountIds: [42 as unknown as string] })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ accountIds: [''] })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ platforms: ['bilibili' as unknown as ProductionActivityGrantV1['platforms'][number]] })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ autoPublish: 'true' as unknown as boolean })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ maxQueuedJobs: -1 })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ maxQueuedJobs: 1.5 })), 'grant_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, makeGrant({ maxQueuedJobs: Number.NaN })), 'grant_invalid');
  });

  it('授权动作列表为空时九类动作全部拒绝', () => {
    const grant = makeGrant({ allowedActions: [] });
    for (const action of AGENT_PRODUCTION_ACTIONS) {
      const request = action === 'queue_publish' ? makePublishRequest() : { action, projectId: PROJECT_ID };
      expectDenied(allow(request, grant), 'action_not_allowed');
    }
  });

  it('有效期边界：发行时刻生效，失效时刻即过期', () => {
    const grant = makeGrant({ issuedAtMs: NOW, expiresAtMs: NOW + 1_000 });
    const request = { action: 'quality_check', projectId: PROJECT_ID } as const;
    expectAllowed(allow(request, grant, makeContext({ nowMs: NOW })));
    expectDenied(allow(request, grant, makeContext({ nowMs: NOW - 1 })), 'grant_not_yet_valid');
    expectAllowed(allow(request, grant, makeContext({ nowMs: NOW + 999 })));
    expectDenied(allow(request, grant, makeContext({ nowMs: NOW + 1_000 })), 'grant_expired');
    expectDenied(allow(request, grant, makeContext({ nowMs: NOW + 1_001 })), 'grant_expired');
  });

  it('注入时钟非法时默认拒绝（不回退系统时间）', () => {
    const request = { action: 'quality_check', projectId: PROJECT_ID } as const;
    expectDenied(allow(request, makeGrant(), null), 'clock_invalid');
    expectDenied(allow(request, makeGrant(), {}), 'clock_invalid');
    expectDenied(allow(request, makeGrant(), { nowMs: Number.NaN, usedQueuedJobs: 0 }), 'clock_invalid');
    expectDenied(allow(request, makeGrant(), { nowMs: Number.POSITIVE_INFINITY, usedQueuedJobs: 0 }), 'clock_invalid');
    expectDenied(allow(request, makeGrant(), { nowMs: '1800000000000', usedQueuedJobs: 0 }), 'clock_invalid');
    expectDenied(allow(makePublishRequest(), makeGrant(), { nowMs: Number.NaN, usedQueuedJobs: 0 }), 'clock_invalid');
  });

  it('项目不符一律拒绝', () => {
    expectDenied(allow({ action: 'quality_check', projectId: 'other-project' }), 'project_mismatch');
    expectDenied(allow(makePublishRequest({ projectId: 'other-project' })), 'project_mismatch');
  });

  it('未列出的动作即使 grant 其他字段合法也拒绝', () => {
    const grant = makeGrant({ allowedActions: ['import_recordings', 'queue_publish'] });
    expectAllowed(allow({ action: 'import_recordings', projectId: PROJECT_ID }, grant));
    expectDenied(allow({ action: 'detect_highlights', projectId: PROJECT_ID }, grant), 'action_not_allowed');
    expectDenied(allow({ action: 'render_variants', projectId: PROJECT_ID }, grant), 'action_not_allowed');
  });
});

describe('请求完整性校验', () => {
  it('request 非对象或缺少合法 action 时拒绝', () => {
    for (const bad of [null, undefined, 'quality_check', 42, [], makeContext()]) {
      expectDenied(allow(bad), 'request_invalid');
    }
    expectDenied(allow({ projectId: PROJECT_ID }), 'request_invalid');
    expectDenied(allow({ action: 42, projectId: PROJECT_ID }), 'request_invalid');
    expectDenied(allow({ action: null, projectId: PROJECT_ID }), 'request_invalid');
  });

  it('未知动作拒绝为 unknown_action，不泄露原始输入', () => {
    const decision = allow({ action: 'publish_everything', projectId: PROJECT_ID });
    expectDenied(decision, 'unknown_action');
    expect(JSON.stringify(decision)).not.toContain('publish_everything');
  });

  it('项目 ID 缺失或空白时拒绝', () => {
    expectDenied(allow({ action: 'quality_check' }), 'request_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: '' }), 'request_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: '   ' }), 'request_invalid');
    expectDenied(allow({ action: 'quality_check', projectId: 42 }), 'request_invalid');
    expectDenied(allow(makePublishRequest({ projectId: '' })), 'request_invalid');
  });

  it('queue_publish 必须给出非空账号 ID', () => {
    expectDenied(allow(makePublishRequest({ accountId: '' })), 'request_invalid');
    expectDenied(allow(makePublishRequest({ accountId: '  ' })), 'request_invalid');
    expectDenied(allow(makePublishRequest({ accountId: 42 as unknown as string })), 'request_invalid');
  });

  it('queue_publish 平台必须是四平台之一', () => {
    for (const bad of ['bilibili', 'tencent', 'DOUYIN', '', 42, null]) {
      expectDenied(allow(makePublishRequest({ platform: bad as QueuePublishActionRequest['platform'] })), 'request_invalid');
    }
  });

  it('queue_publish 拟排队数量必须是正整数', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null]) {
      expectDenied(allow(makePublishRequest({ requestedJobs: bad as number })), 'request_invalid');
    }
    expectAllowed(allow(makePublishRequest({ requestedJobs: 1 })));
  });

  it('queue_publish 缺少 commerceRequest 字段时视为请求不完整', () => {
    const withoutCommerce: Record<string, unknown> = { ...makePublishRequest() };
    delete withoutCommerce.commerceRequest;
    expectDenied(allow(withoutCommerce), 'request_invalid');
  });
});

describe('queue_publish：账号、平台与自动发布开关', () => {
  it('两个许可账号分别通过，第三个账号拒绝', () => {
    const grant = makeGrant();
    expectAllowed(allow(makePublishRequest({ accountId: 'acct-douyin-1' }), grant));
    expectAllowed(allow(makePublishRequest({ accountId: 'acct-xhs-2', platform: 'xiaohongshu' }), grant));
    expectDenied(allow(makePublishRequest({ accountId: 'acct-other' }), grant), 'account_not_allowed');
  });

  it('两个许可平台分别通过，契约内未授权平台拒绝', () => {
    const grant = makeGrant();
    expectAllowed(allow(makePublishRequest({ platform: 'douyin' }), grant));
    expectAllowed(allow(makePublishRequest({ platform: 'xiaohongshu' }), grant));
    expectDenied(allow(makePublishRequest({ platform: 'kuaishou' }), grant), 'platform_not_allowed');
    expectDenied(allow(makePublishRequest({ platform: 'wechat-channels' }), grant), 'platform_not_allowed');
  });

  it('autoPublish 未显式打开时拒绝，即使动作已授权、账号和平台均合法', () => {
    expectDenied(allow(makePublishRequest(), makeGrant({ autoPublish: false })), 'auto_publish_disabled');
    expectDenied(
      allow(makePublishRequest(), makeGrant({ autoPublish: false, accountIds: ['acct-douyin-1'], platforms: ['douyin'] })),
      'auto_publish_disabled',
    );
  });

  it('queue_publish 不在授权动作列表时先于账号范围拒绝', () => {
    const grant = makeGrant({
      allowedActions: ['import_recordings', 'render_variants'],
      accountIds: [],
      autoPublish: true,
    });
    expectDenied(allow(makePublishRequest(), grant), 'action_not_allowed');
  });

  it('账号范围先于平台范围判定', () => {
    const grant = makeGrant({ accountIds: ['acct-douyin-1'], platforms: ['xiaohongshu'] });
    expectDenied(allow(makePublishRequest({ accountId: 'acct-other', platform: 'douyin' }), grant), 'account_not_allowed');
  });
});

describe('queue_publish：配额临界与非法额度', () => {
  it('used + requested == max 允许，超出 1 即拒绝', () => {
    const grant = makeGrant({ maxQueuedJobs: 5 });
    expectAllowed(allow(makePublishRequest({ requestedJobs: 5 }), grant, makeContext({ usedQueuedJobs: 0 })));
    expectAllowed(allow(makePublishRequest({ requestedJobs: 2 }), grant, makeContext({ usedQueuedJobs: 3 })));
    expectAllowed(allow(makePublishRequest({ requestedJobs: 1 }), grant, makeContext({ usedQueuedJobs: 4 })));
    expectDenied(allow(makePublishRequest({ requestedJobs: 3 }), grant, makeContext({ usedQueuedJobs: 3 })), 'publish_quota_exceeded');
    expectDenied(allow(makePublishRequest({ requestedJobs: 1 }), grant, makeContext({ usedQueuedJobs: 5 })), 'publish_quota_exceeded');
    expectDenied(allow(makePublishRequest({ requestedJobs: 6 }), grant, makeContext({ usedQueuedJobs: 0 })), 'publish_quota_exceeded');
  });

  it('maxQueuedJobs 为 0 时任何发布都拒绝', () => {
    expectDenied(allow(makePublishRequest({ requestedJobs: 1 }), makeGrant({ maxQueuedJobs: 0 }), makeContext({ usedQueuedJobs: 0 })), 'publish_quota_exceeded');
  });

  it('已使用额度非法时拒绝', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '0', null, undefined]) {
      expectDenied(
        allow(makePublishRequest(), makeGrant(), makeContext({ usedQueuedJobs: bad as number })),
        'used_jobs_invalid',
      );
    }
  });
});

describe('queue_publish：配额字段安全整数边界（第二轮定向修复）', () => {
  const MAX = Number.MAX_SAFE_INTEGER;

  it('三个配额字段在安全整数范围内的精确边界可用', () => {
    const grant = makeGrant({ maxQueuedJobs: MAX });
    // requested == max（used=0）：精确边界允许
    expectAllowed(allow(makePublishRequest({ requestedJobs: MAX }), grant, makeContext({ usedQueuedJobs: 0 })));
    // used + requested == max（均为安全整数）：精确边界允许
    expectAllowed(allow(makePublishRequest({ requestedJobs: 1 }), grant, makeContext({ usedQueuedJobs: MAX - 1 })));
    // 超出 1 即拒绝
    expectDenied(
      allow(makePublishRequest({ requestedJobs: 2 }), grant, makeContext({ usedQueuedJobs: MAX - 1 })),
      'publish_quota_exceeded',
    );
  });

  it('requestedJobs 超出安全整数范围拒绝（MAX_SAFE_INTEGER+1 与 1e308 都是 Number.isInteger 陷阱）', () => {
    for (const bad of [MAX + 1, 1e308]) {
      expectDenied(
        allow(makePublishRequest({ requestedJobs: bad }), makeGrant({ maxQueuedJobs: MAX })),
        'request_invalid',
      );
    }
  });

  it('usedQueuedJobs 超出安全整数范围拒绝（MAX_SAFE_INTEGER+1 与 1e308）', () => {
    for (const bad of [MAX + 1, 1e308]) {
      expectDenied(
        allow(makePublishRequest(), makeGrant({ maxQueuedJobs: MAX }), makeContext({ usedQueuedJobs: bad })),
        'used_jobs_invalid',
      );
    }
  });

  it('maxQueuedJobs 超出安全整数范围拒绝（MAX_SAFE_INTEGER+1 与 1e308）', () => {
    for (const bad of [MAX + 1, 1e308]) {
      expectDenied(allow(makePublishRequest(), makeGrant({ maxQueuedJobs: bad })), 'grant_invalid');
    }
  });

  it('used + requested 超过上限时拒绝，不得依赖非安全数值加法取整放行', () => {
    const grant = makeGrant({ maxQueuedJobs: MAX });
    // 真实总和 2*MAX-1 远超上限；必须用安全减法比较拒绝，而不是浮点加法碰运气
    expectDenied(
      allow(makePublishRequest({ requestedJobs: MAX }), grant, makeContext({ usedQueuedJobs: MAX - 1 })),
      'publish_quota_exceeded',
    );
    // used == max 时任何正请求数都拒绝
    expectDenied(
      allow(makePublishRequest({ requestedJobs: 1 }), grant, makeContext({ usedQueuedJobs: MAX })),
      'publish_quota_exceeded',
    );
  });

  it('usedQueuedJobs 大于 maxQueuedJobs 时拒绝（剩余额度为负不放行）', () => {
    expectDenied(
      allow(makePublishRequest({ requestedJobs: 1 }), makeGrant({ maxQueuedJobs: 3 }), makeContext({ usedQueuedJobs: 5 })),
      'publish_quota_exceeded',
    );
  });
});

describe('queue_publish：商品请求一律截止', () => {
  const commerce = {
    platform: 'douyin' as const,
    accountId: 'acct-douyin-1',
    kind: 'shop' as const,
    platformProductId: 'prod-123',
    required: true,
  };

  it('commerceRequest 非 null 时拒绝（完整对象）', () => {
    expectDenied(allow(makePublishRequest({ commerceRequest: commerce })), 'commerce_not_supported');
  });

  it('commerceRequest 为任意非 null 值都拒绝，不尝试解析或降级', () => {
    for (const bad of ['prod-123', 0, false, {}, []]) {
      expectDenied(
        allow(makePublishRequest({ commerceRequest: bad as QueuePublishActionRequest['commerceRequest'] })),
        'commerce_not_supported',
      );
    }
  });

  it('commerceRequest 显式为 null 且其余合法时允许普通发布', () => {
    expectAllowed(allow(makePublishRequest({ commerceRequest: null })));
  });
});

describe('非发布创作动作', () => {
  it('无需账号/平台，也不受 autoPublish 与已用额度影响，但仍需有效活动授权', () => {
    const grant = makeGrant({
      allowedActions: [...AGENT_PRODUCTION_ACTIONS],
      accountIds: [],
      platforms: [],
      autoPublish: false,
      maxQueuedJobs: 0,
    });
    for (const action of NON_PUBLISH_ACTIONS) {
      expectAllowed(
        allow({ action, projectId: PROJECT_ID }, grant, makeContext({ usedQueuedJobs: Number.NaN })),
      );
    }
  });

  it('创作动作同样受期限、项目与动作列表约束', () => {
    const expired = makeGrant({ issuedAtMs: NOW - 10_000, expiresAtMs: NOW });
    expectDenied(allow({ action: 'edit_timeline', projectId: PROJECT_ID }, expired), 'grant_expired');
    expectDenied(allow({ action: 'edit_timeline', projectId: 'other-project' }), 'project_mismatch');
    const limited = makeGrant({ allowedActions: ['import_recordings'] });
    expectDenied(allow({ action: 'quality_check', projectId: PROJECT_ID }, limited), 'action_not_allowed');
  });

  it('完全许可活动下九类动作全部可通过（发布使用合法账号与额度）', () => {
    const grant = makeGrant();
    for (const action of NON_PUBLISH_ACTIONS) {
      expectAllowed(allow({ action, projectId: PROJECT_ID }, grant));
    }
    expectAllowed(allow(makePublishRequest(), grant, makeContext({ usedQueuedJobs: 0 })));
  });
});

describe('判定次序、脱敏与无副作用', () => {
  it('固定判定次序：grant 结构 → 时钟 → 期限 → 项目 → 动作 → 账号 → 平台 → 开关 → 额度 → 配额 → 商品', () => {
    const expiredGrant = makeGrant({ issuedAtMs: NOW - 10_000, expiresAtMs: NOW, allowedActions: [] });
    expectDenied(allow({ action: 'quality_check', projectId: 'other-project' }, expiredGrant), 'grant_expired');

    const actionFirst = makeGrant({ allowedActions: [], accountIds: [], autoPublish: false });
    expectDenied(allow(makePublishRequest(), actionFirst), 'action_not_allowed');

    const accountFirst = makeGrant({ accountIds: [], platforms: [], autoPublish: false });
    expectDenied(allow(makePublishRequest(), accountFirst), 'account_not_allowed');

    const platformFirst = makeGrant({ platforms: [], autoPublish: false });
    expectDenied(allow(makePublishRequest(), platformFirst), 'platform_not_allowed');

    const autoFirst = makeGrant({ autoPublish: false });
    expectDenied(allow(makePublishRequest(), autoFirst, makeContext({ usedQueuedJobs: Number.NaN })), 'auto_publish_disabled');

    expectDenied(
      allow(
        makePublishRequest({ commerceRequest: { platform: 'douyin', accountId: 'acct-douyin-1', kind: 'shop', platformProductId: 'p', required: false } }),
        makeGrant(),
        makeContext({ usedQueuedJobs: Number.NaN }),
      ),
      'used_jobs_invalid',
    );

    expectDenied(
      allow(
        makePublishRequest({ requestedJobs: 5, commerceRequest: { platform: 'douyin', accountId: 'acct-douyin-1', kind: 'shop', platformProductId: 'p', required: false } }),
        makeGrant({ maxQueuedJobs: 4 }),
        makeContext({ usedQueuedJobs: 0 }),
      ),
      'publish_quota_exceeded',
    );
  });

  it('拒绝结果只含 allowed + reason，不含账号 / 项目等原始输入', () => {
    const decision = allow(
      makePublishRequest({ accountId: 'secret-account-name', projectId: 'secret-project' }),
      makeGrant({ projectId: 'different-project' }),
    );
    expect(decision).toEqual({ allowed: false, reason: 'project_mismatch' });
    expect(Object.keys(decision).sort()).toEqual(['allowed', 'reason']);
    const serialized = JSON.stringify(decision);
    expect(serialized).not.toContain('secret-account-name');
    expect(serialized).not.toContain('secret-project');
    expect(serialized).not.toContain('different-project');
  });

  it('纯函数：不修改输入对象，重复调用结果一致', () => {
    const request = makePublishRequest({ requestedJobs: 2 });
    const grant = makeGrant();
    const context = makeContext({ usedQueuedJobs: 1 });
    const requestBefore = JSON.stringify(request);
    const grantBefore = JSON.stringify(grant);
    const contextBefore = JSON.stringify(context);
    const first = evaluateAgentProductionAction(request, grant, context);
    const second = evaluateAgentProductionAction(request, grant, context);
    expect(first).toEqual(second);
    expect(first).toEqual({ allowed: true });
    expect(JSON.stringify(request)).toBe(requestBefore);
    expect(JSON.stringify(grant)).toBe(grantBefore);
    expect(JSON.stringify(context)).toBe(contextBefore);
  });
});