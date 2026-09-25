/**
 * AgentPicker — 新建会话时显式选择 agent。
 *
 * 当前 runtime 只内置 pi 一个 agent（codex/claude 已下线），候选列表从
 * `listAgentPresentations()` 取，因此自然只渲染 Pi 一项。组件本身与具体 agent
 * 无关：未来若再接入多 agent，无需改动此处即可恢复多选。被 ChatComposer 复用。
 *
 * 可用性：挂载时对每个候选 agent 调 `runPreflight(agentId)` 探测可用性。
 * 任一检查项 status 为 'fail' 即视为不可用，置灰并用 installGuide 作为 tooltip。
 * 遵守 DESIGN.md：复用 PillGroup（系统蓝），无第二 accent、无新弹窗。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { listAgentPresentations } from '../../lib/agent-presentation';
import { AgentIcon } from './AgentIcon';
import { PillGroup, type PillGroupItem } from '../../ui/patterns/PillGroup';

/** 单个 agent 的可用性状态。'checking' 期间不禁用（乐观），'available' 可选，'unavailable' 置灰。 */
type Availability = 'checking' | 'available' | 'unavailable';

interface AgentPickerProps {
  value: string;
  onChange: (agentId: string) => void;
}

/** 根据 preflight 结果判定可用性：任一 fail 即不可用。 */
function deriveAvailability(checks: { status: string }[]): Availability {
  return checks.some((c) => c.status === 'fail') ? 'unavailable' : 'available';
}

export function AgentPicker({ value, onChange }: AgentPickerProps): React.ReactElement {
  const presentations = useMemo(() => listAgentPresentations(), []);

  // agentId → 可用性；初始全部 'checking'（乐观，不禁用）。
  const [availability, setAvailability] = useState<Record<string, Availability>>(() =>
    Object.fromEntries(presentations.map((p) => [p.id, 'checking' as Availability])),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.agentAPI === 'undefined') return;
    let cancelled = false;

    void Promise.all(
      presentations.map(async (p) => {
        try {
          const checks = await window.agentAPI.runPreflight(p.id);
          return [p.id, deriveAvailability(checks)] as const;
        } catch {
          // 探测失败不阻塞选择，保持可用（乐观）。
          return [p.id, 'available'] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setAvailability(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [presentations]);

  const items: PillGroupItem<string>[] = presentations.map((p) => {
    const state = availability[p.id] ?? 'checking';
    const unavailable = state === 'unavailable';
    return {
      value: p.id,
      disabled: unavailable,
      label: (
        <span
          className="agent-picker__item"
          data-agent-id={p.id}
          data-availability={state}
          title={unavailable ? p.installGuide ?? `${p.displayName} 当前不可用` : p.displayName}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            opacity: unavailable ? 0.45 : 1,
          }}
        >
          <AgentIcon agentId={p.id} size={16} />
          <span>{p.displayName}</span>
        </span>
      ),
    };
  });

  return (
    <div className="agent-picker" role="group" aria-label="选择 Agent">
      <PillGroup<string> items={items} value={value} onChange={onChange} size="sm" />
    </div>
  );
}
