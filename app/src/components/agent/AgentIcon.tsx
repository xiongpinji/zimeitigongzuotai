/**
 * AgentIcon — 每个 Agent 的身份图标，用于会话列表、消息头等场景。
 * 单色/系统蓝风格，遵守 DESIGN.md：不引入第二套彩色 accent。
 */

import React from 'react';

interface AgentIconConfig {
  /** aria-label / title 文本，英文名，便于测试断言与无障碍 */
  label: string;
  /** 渲染图标 SVG，接收 size */
  content: (size: number) => React.ReactElement;
}

function PiSVG({ size }: { size: number }) {
  // π 字符
  const cx = size / 2;
  const cy = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      aria-hidden="true"
    >
      <text
        x={cx}
        y={cy + size * 0.13}
        textAnchor="middle"
        fontSize={size * 0.6}
        fill="currentColor"
        fontFamily="'SF Pro Text', 'Helvetica Neue', Arial, serif"
        fontWeight="500"
      >
        π
      </text>
    </svg>
  );
}

function DefaultSVG({ size }: { size: number }) {
  // 实心圆点，中性
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.28;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      aria-hidden="true"
    >
      <circle cx={cx} cy={cy} r={r} fill="currentColor" opacity={0.6} />
    </svg>
  );
}

/** agentId → 配置映射，支持带/不带 "-acp" 后缀；agentId 缺省或未知时回退默认 */
function resolveConfig(agentId: string | null | undefined): AgentIconConfig {
  const normalized = (agentId ?? '').toLowerCase().replace(/-acp$/, '');
  switch (normalized) {
    case 'pi':
      return { label: 'Pi', content: (size: number) => <PiSVG size={size} /> };
    default:
      return { label: 'Agent', content: (size: number) => <DefaultSVG size={size} /> };
  }
}

export function AgentIcon({
  agentId,
  size = 16,
}: {
  agentId?: string | null;
  size?: number;
}): React.ReactElement {
  const config = resolveConfig(agentId);

  return (
    <span
      role="img"
      aria-label={config.label}
      title={config.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        color: 'var(--color-system-blue, #0A84FF)',
      }}
    >
      {config.content(size)}
    </span>
  );
}
