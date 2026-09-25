/**
 * ModelReasoningPicker — composer 底栏的「模型 + 思考程度」合并芯片。
 *
 * 取代旧的 ModelPicker（含 agent 名）+ 独立 ThinkingLevelPicker 两件套：
 *  - 不再展示 agent 名（pi 等框架标识已由 AI 面板右上角 ChatHeader 呈现，避免重复）。
 *  - 单芯片直接展示「模型名 + 当前思考档」（如 `gpt-5.1 超高`），点击向上弹出 popover。
 *  - popover 内：顶部「推理」档位列表（来自 agent reasoningOptions），分隔线下方一个
 *    「模型」行，点击展开二级浮层（portal）列出全部模型（参考截图的级联菜单）。
 *  - 该 agent 无 reasoningOptions 时退化为纯模型列表（直接列在 popover 内，无二级）。
 *
 * 模型列表经 useAgentModels 动态拉取（pi 走 `pi --list-models`），失败回退静态兜底。
 * 视觉复用系统蓝 token，无第二 accent；轻量自包含 popover，便于 jsdom 测试。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAgentPresentation } from '../../lib/agent-presentation';
import { useAgentModels } from '../../lib/use-agent-models';

interface ModelReasoningPickerProps {
  /** 当前 agent id（用于取模型 / 思考档元数据；不展示 agent 名）。 */
  agentId: string;
  /** 当前模型 id；缺省回退 defaultModel 或首个模型。 */
  modelValue?: string;
  /** 模型切换回调。 */
  onModelChange: (modelId: string) => void;
  /** 当前思考档 id；缺省回退 defaultReasoning 或首项。 */
  reasoningValue?: string;
  /** 思考档切换回调。 */
  onReasoningChange: (reasoningId: string) => void;
  disabled?: boolean;
}

const CHECK_PATH = 'M2.5 6.5L5 9l4.5-5';

function Chevron({ dir = 'down' }: { dir?: 'down' | 'right' }) {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d={dir === 'down' ? 'M2.5 4.5L6 8l3.5-3.5' : 'M4.5 2.5L8 6l-3.5 3.5'}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d={CHECK_PATH} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const MENU_STYLE: React.CSSProperties = {
  minWidth: 180,
  maxHeight: 280,
  overflowY: 'auto',
  padding: 4,
  borderRadius: 10,
  border: '1px solid var(--color-separator, rgba(255,255,255,0.12))',
  background: 'var(--color-bg-elevated, #2c2c2e)',
  boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
  zIndex: 9999,
};

function optionStyle(selected: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    padding: '6px 10px',
    borderRadius: 7,
    border: 'none',
    background: selected ? 'var(--color-system-blue, #0A84FF)' : 'transparent',
    color: selected ? '#fff' : 'var(--color-label, inherit)',
    fontSize: 12,
    textAlign: 'left',
    cursor: 'pointer',
  };
}

export function ModelReasoningPicker({
  agentId,
  modelValue,
  onModelChange,
  reasoningValue,
  onReasoningChange,
  disabled,
}: ModelReasoningPickerProps): React.ReactElement {
  const presentation = useMemo(() => getAgentPresentation(agentId), [agentId]);
  const { models, loading } = useAgentModels(agentId);
  const reasoningOptions = presentation.reasoningOptions ?? [];
  const hasReasoning = reasoningOptions.length > 0;

  const currentModelId = modelValue ?? presentation.defaultModel ?? models[0]?.id;
  const currentModel = models.find((m) => m.id === currentModelId);
  const currentModelLabel = currentModel?.label ?? currentModelId ?? '默认模型';

  const currentReasoningId = reasoningValue ?? presentation.defaultReasoning ?? reasoningOptions[0]?.id;
  const currentReasoning = reasoningOptions.find((o) => o.id === currentReasoningId);
  const currentReasoningLabel = currentReasoning?.label ?? currentReasoningId;

  const [open, setOpen] = useState(false);
  const [modelFlyoutOpen, setModelFlyoutOpen] = useState(false);
  const [flyoutPos, setFlyoutPos] = useState<{ right: number; bottom: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || flyoutRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  // 主菜单收起时一并收起二级浮层。
  useEffect(() => {
    if (!open) setModelFlyoutOpen(false);
  }, [open]);

  const closeAll = () => {
    setOpen(false);
    setModelFlyoutOpen(false);
  };

  const toggleModelFlyout = () => {
    setModelFlyoutOpen((v) => {
      const next = !v;
      if (next && modelTriggerRef.current) {
        const rect = modelTriggerRef.current.getBoundingClientRect();
        // 浮层右边缘贴在「模型」行左侧（向左上展开），底部与该行对齐。
        setFlyoutPos({
          right: Math.round(window.innerWidth - rect.left + 6),
          bottom: Math.round(window.innerHeight - rect.bottom),
        });
      }
      return next;
    });
  };

  const handleSelectModel = (id: string) => {
    onModelChange(id);
    closeAll();
  };

  const modelList = (
    <>
      {loading && (
        <div
          data-testid="model-reasoning-loading"
          style={{ padding: '6px 10px', fontSize: 12, color: 'var(--color-label-secondary, #98989d)' }}
        >
          加载模型…
        </div>
      )}
      {!loading && models.length === 0 && (
        <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--color-label-secondary, #98989d)' }}>
          {currentModelLabel}
        </div>
      )}
      {models.map((model) => {
        const selected = model.id === currentModelId;
        return (
          <button
            key={model.id}
            type="button"
            role="option"
            aria-selected={selected}
            data-model-id={model.id}
            onClick={() => handleSelectModel(model.id)}
            style={optionStyle(selected)}
          >
            <span style={{ flex: 1 }}>{model.label}</span>
            {selected && <Check />}
          </button>
        );
      })}
    </>
  );

  return (
    <div
      ref={rootRef}
      className="model-reasoning-picker"
      data-agent-id={agentId}
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      <button
        type="button"
        data-testid="model-reasoning-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="模型与思考程度"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          height: 24,
          padding: '0 8px',
          borderRadius: 7,
          border: '1px solid var(--color-separator, rgba(255,255,255,0.12))',
          background: 'var(--color-fill-quaternary, rgba(120,120,128,0.12))',
          fontSize: 12,
          lineHeight: 1,
          cursor: disabled ? 'default' : 'pointer',
          color: 'var(--color-system-blue, #0A84FF)',
          fontWeight: 500,
          opacity: disabled ? 0.4 : 1,
          maxWidth: 200,
        }}
      >
        <span
          style={{
            maxWidth: 120,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {currentModelLabel}
        </span>
        {hasReasoning && currentReasoningLabel && (
          <span style={{ color: 'var(--color-label-secondary, #98989d)', fontWeight: 400 }}>
            {currentReasoningLabel}
          </span>
        )}
        <Chevron />
      </button>

      {open && (
        <div
          className="model-reasoning-picker__menu"
          role="menu"
          aria-label="模型与思考程度"
          style={{ position: 'absolute', bottom: 'calc(100% + 4px)', right: 0, ...MENU_STYLE }}
        >
          {hasReasoning ? (
            <>
              <div
                style={{
                  padding: '4px 10px 4px',
                  fontSize: 11,
                  color: 'var(--color-label-secondary, #98989d)',
                }}
              >
                推理
              </div>
              {reasoningOptions.map((opt) => {
                const selected = opt.id === currentReasoningId;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    data-reasoning-id={opt.id}
                    onClick={() => {
                      onReasoningChange(opt.id);
                      setModelFlyoutOpen(false);
                    }}
                    style={optionStyle(selected)}
                  >
                    <span style={{ flex: 1 }}>{opt.label}</span>
                    {selected && <Check />}
                  </button>
                );
              })}
              <div style={{ margin: '4px 6px', height: 1, background: 'var(--color-separator, rgba(255,255,255,0.12))' }} />
              <button
                ref={modelTriggerRef}
                type="button"
                data-testid="model-reasoning-model-trigger"
                aria-haspopup="listbox"
                aria-expanded={modelFlyoutOpen}
                onClick={toggleModelFlyout}
                style={{
                  ...optionStyle(false),
                  background: modelFlyoutOpen ? 'var(--color-fill-quaternary, rgba(120,120,128,0.18))' : 'transparent',
                }}
              >
                <span style={{ color: 'var(--color-label-secondary, #98989d)' }}>模型</span>
                <span
                  style={{
                    flex: 1,
                    textAlign: 'right',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--color-system-blue, #0A84FF)',
                  }}
                >
                  {currentModelLabel}
                </span>
                <span style={{ color: 'var(--color-label-secondary, #98989d)' }}>
                  <Chevron dir="right" />
                </span>
              </button>
            </>
          ) : (
            <div role="listbox" aria-label="选择模型">
              {modelList}
            </div>
          )}
        </div>
      )}

      {open && hasReasoning && modelFlyoutOpen && flyoutPos &&
        createPortal(
          <div
            ref={flyoutRef}
            className="model-reasoning-picker__flyout"
            role="listbox"
            aria-label="选择模型"
            style={{ position: 'fixed', right: flyoutPos.right, bottom: flyoutPos.bottom, ...MENU_STYLE }}
          >
            {modelList}
          </div>,
          document.body,
        )}
    </div>
  );
}
