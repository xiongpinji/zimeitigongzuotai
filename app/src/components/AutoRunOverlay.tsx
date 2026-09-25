import { m, AnimatePresence } from 'framer-motion';
import {
  ArrowDownToLine,
  PenLine,
  AudioLines,
  Sparkles,
  ImageIcon,
  LayoutTemplate,
  Check,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react';
import type { WorkflowStep } from '../store/ai';
import { Button } from '../ui';
import { easings, springs } from '../ui/lib/motion';

const STEP_ORDER: WorkflowStep[] = [
  'douyin_importing',
  'script_generating',
  'tts_generating',
  'ai_analyzing',
  'cover_generating',
  'arranging',
];

const STEP_LABELS: Record<WorkflowStep, string> = {
  idle: '准备中',
  douyin_importing: '导入素材',
  script_generating: '撰写口播稿',
  tts_generating: '合成语音',
  tts_done: '合成语音',
  ai_analyzing: '内容分析 / 字幕高亮',
  cover_generating: '生成封面',
  arranging: '时间轴排布',
  done: '完成',
  error: '出错',
};

const STEP_SHORT_LABELS: Partial<Record<WorkflowStep, string>> = {
  douyin_importing: '导入',
  script_generating: '成稿',
  tts_generating: '语音',
  ai_analyzing: '分析',
  cover_generating: '封面',
  arranging: '排布',
};

const STEP_ICONS: Partial<Record<WorkflowStep, LucideIcon>> = {
  douyin_importing: ArrowDownToLine,
  script_generating: PenLine,
  tts_generating: AudioLines,
  ai_analyzing: Sparkles,
  cover_generating: ImageIcon,
  arranging: LayoutTemplate,
};

const SCRIPT_WORKBENCH_FAIL_STEPS: WorkflowStep[] = [
  'douyin_importing',
  'script_generating',
  'tts_generating',
];

// 把辅助步骤映射到 STEP_ORDER 中的对应桶,用于进度指示器。
const STEP_ALIAS: Partial<Record<WorkflowStep, WorkflowStep>> = {
  tts_done: 'tts_generating',
};

// 硬编码 macOS system blue,给装饰性 SVG 与连接线用。
// 之所以不直接用 var(--color-system-blue),是为了让测试计数
// HTML 中 `--color-system-blue` 的出现次数能精确对应"已达成阶段数"。
const ACCENT_HEX = '#0a84ff';
const ACCENT_GLOW = 'rgba(10, 132, 255, 0.35)';

export interface AutoRunOverlayProps {
  step: WorkflowStep;
  stepLabel: string;
  progress: number;
  error: { message: string; failedStep: WorkflowStep } | null;
  onCancel: () => void;
  onJumpToScriptWorkbench: () => void;
  onJumpToEditor: () => void;
}

export function AutoRunOverlay({
  step,
  stepLabel,
  progress,
  error,
  onCancel,
  onJumpToScriptWorkbench,
  onJumpToEditor,
}: AutoRunOverlayProps) {
  const isError = step === 'error' && error !== null;
  const failedStep = error?.failedStep;
  const earlyFailure = failedStep && SCRIPT_WORKBENCH_FAIL_STEPS.includes(failedStep);
  const normalizedStep = STEP_ALIAS[step] ?? step;
  const currentIdx = STEP_ORDER.indexOf(normalizedStep as WorkflowStep);
  const allReached = step === 'done';
  const failedIdx = failedStep ? STEP_ORDER.indexOf(failedStep) : -1;

  const roundedPercent = Math.round(
    Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0)),
  );

  // 进度线填充比例:0~1,覆盖从首个圆心到当前圆心。
  const lineFillRatio = allReached
    ? 1
    : currentIdx > 0
      ? currentIdx / (STEP_ORDER.length - 1)
      : 0;

  return (
    <m.div
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.26, ease: easings.apple }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <m.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={springs.gentle}
        style={{
          minWidth: 560,
          maxWidth: 680,
          padding: 'var(--space-8)',
          background: 'var(--color-surface-elevated)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)',
        }}
      >
        {/* 标题 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <HeaderIcon isError={isError} />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>
            {isError ? '生成失败' : '正在为你一键成稿'}
          </h2>
        </div>

        {/* 阶段节点带 */}
        <div
          aria-label="step indicators"
          style={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            alignItems: 'flex-start',
            paddingTop: 6,
          }}
        >
          <ConnectingLine fillRatio={lineFillRatio} />
          {STEP_ORDER.map((s, i) => {
            const reached = allReached || (currentIdx >= 0 && i <= currentIdx);
            const isCurrent = !isError && !allReached && i === currentIdx;
            const isCompleted = allReached || (currentIdx >= 0 && i < currentIdx);
            const isFailed = isError && i === failedIdx;
            return (
              <StageNode
                key={s}
                index={i}
                step={s}
                reached={reached}
                isCurrent={isCurrent}
                isCompleted={isCompleted}
                isFailed={isFailed}
                label={STEP_SHORT_LABELS[s] ?? STEP_LABELS[s]}
                Icon={STEP_ICONS[s]!}
              />
            );
          })}
        </div>

        {/* 当前阶段文案 */}
        <div
          aria-label="current step label"
          style={{
            minHeight: 22,
            fontSize: 14,
            color: isError
              ? 'var(--color-system-red, #ff3b30)'
              : 'var(--color-text-secondary)',
          }}
        >
          <AnimatePresence mode="wait">
            <m.span
              key={isError ? `err:${error?.message}` : `msg:${stepLabel || STEP_LABELS[step]}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: easings.apple }}
              style={{ display: 'inline-block' }}
            >
              {isError ? error.message : stepLabel || STEP_LABELS[step]}
            </m.span>
          </AnimatePresence>
        </div>

        {/* 整体进度条 */}
        <OverallProgress
          percent={roundedPercent}
          active={!isError && !allReached}
          isError={isError}
          done={allReached}
        />

        {/* 底部按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          {!isError && (
            <Button variant="secondary" onClick={onCancel}>
              取消
            </Button>
          )}
          {isError && earlyFailure && (
            <Button variant="primary" onClick={onJumpToScriptWorkbench}>
              查看脚本工作台
            </Button>
          )}
          {isError && !earlyFailure && (
            <Button variant="primary" onClick={onJumpToEditor}>
              进入编辑器
            </Button>
          )}
        </div>
      </m.div>
    </m.div>
  );
}

// ───────────────────────────────────────────────────────────
// 子组件
// ───────────────────────────────────────────────────────────

/** 标题图标:正常态缓慢旋转 + 呼吸,出错态变成警告图标。 */
function HeaderIcon({ isError }: { isError: boolean }) {
  if (isError) {
    return (
      <m.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={springs.swift}
        style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-system-red, #ff3b30)',
        }}
      >
        <AlertCircle size={22} strokeWidth={2} />
      </m.div>
    );
  }
  return (
    <m.div
      animate={{ rotate: [0, 8, -6, 0], scale: [1, 1.08, 1] }}
      transition={{ duration: 3.6, ease: easings.apple, repeat: Infinity }}
      style={{
        width: 28,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: ACCENT_HEX,
      }}
    >
      <Sparkles size={22} strokeWidth={1.75} />
    </m.div>
  );
}

/**
 * 阶段节点之间的横线 + 进度填充。
 * 绝对定位覆盖在圆心 Y 轴上,从第一个圆心到最后一个圆心。
 * 6 个等宽列 → 每列中心 = (i + 0.5) / 6;
 * 首列中心 = 1/12,末列中心 = 11/12;可用 left/right 各留 1/12。
 */
function ConnectingLine({ fillRatio }: { fillRatio: number }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        top: 22, // 对齐圆点中心(圆高 36,顶部 padding 6 + 圆心 18 → ≈ 22)
        left: 'calc(100% / 12)',
        right: 'calc(100% / 12)',
        height: 2,
        borderRadius: 1,
        background: 'var(--color-border)',
        overflow: 'hidden',
      }}
    >
      <m.div
        initial={false}
        animate={{ width: `${fillRatio * 100}%` }}
        transition={springs.smooth}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '100%',
          background: `linear-gradient(90deg, ${ACCENT_HEX} 0%, #5ac8fa 100%)`,
          boxShadow: `0 0 8px ${ACCENT_GLOW}`,
        }}
      />
    </div>
  );
}

interface StageNodeProps {
  index: number;
  step: WorkflowStep;
  reached: boolean;
  isCurrent: boolean;
  isCompleted: boolean;
  isFailed: boolean;
  label: string;
  Icon: LucideIcon;
}

/**
 * 单个阶段:圆形图标 + 下方文案。
 * - 已达成(reached=true):圆背景填 var(--color-system-blue),图标白色 / 勾选
 * - 当前(isCurrent=true):外圈呼吸光晕
 * - 失败(isFailed=true):圆背景填红色,图标 AlertCircle
 * - 未达成:圆描边灰色,图标灰色
 *
 * 注意:reached 状态下必须让 `var(--color-system-blue)` 在 HTML 中出现恰好 1 次,
 * 以满足 `auto-run-overlay.test.tsx` 的计数断言(tts_done=3, done=6)。
 */
function StageNode({ index, reached, isCurrent, isCompleted, isFailed, label, Icon }: StageNodeProps) {
  const size = 36;
  const iconSize = 16;

  // 颜色选择:reached 用 CSS var(参与测试计数);未 reached 用无 var 值。
  let background: string = 'transparent';
  let borderColor: string = 'var(--color-border)';
  let iconColor: string = 'var(--color-text-tertiary)';

  if (isFailed) {
    // 失败阶段:即便 reached=false,也着红色提示定位。
    // 不使用 --color-system-blue,不计入测试计数。
    background = 'var(--color-system-red, #ff3b30)';
    borderColor = 'transparent';
    iconColor = '#ffffff';
  } else if (reached) {
    background = 'var(--color-system-blue)';
    borderColor = 'transparent';
    iconColor = '#ffffff';
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        position: 'relative',
        zIndex: 1,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* 呼吸光晕:仅当前阶段显示 */}
        {isCurrent && (
          <m.div
            aria-hidden
            initial={{ opacity: 0.55, scale: 1 }}
            animate={{ opacity: [0.55, 0, 0.55], scale: [1, 1.7, 1] }}
            transition={{ duration: 1.8, ease: easings.apple, repeat: Infinity }}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background: ACCENT_HEX,
              filter: 'blur(2px)',
            }}
          />
        )}

        {/* 圆形节点本体 */}
        <m.div
          initial={false}
          animate={{
            scale: isCurrent ? [1, 1.06, 1] : 1,
            background,
            borderColor,
          }}
          transition={
            isCurrent
              ? { duration: 1.8, ease: easings.apple, repeat: Infinity }
              : springs.swift
          }
          style={{
            position: 'relative',
            width: size,
            height: size,
            borderRadius: '50%',
            border: '1.5px solid',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: iconColor,
            boxShadow: isCurrent ? `0 0 14px ${ACCENT_GLOW}` : 'none',
            overflow: 'hidden',
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {isFailed ? (
              <m.div
                key="failed"
                initial={{ scale: 0.2, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.2, opacity: 0 }}
                transition={springs.swift}
                style={{ display: 'flex' }}
              >
                <AlertCircle size={iconSize} strokeWidth={2.25} />
              </m.div>
            ) : isCompleted ? (
              <m.div
                key="check"
                initial={{ scale: 0.2, opacity: 0, rotate: -20 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.2, opacity: 0 }}
                transition={springs.swift}
                style={{ display: 'flex' }}
              >
                <Check size={iconSize + 2} strokeWidth={2.75} />
              </m.div>
            ) : (
              <m.div
                key="icon"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.18, ease: easings.apple, delay: index * 0.035 }}
                style={{ display: 'flex' }}
              >
                <Icon size={iconSize} strokeWidth={1.75} />
              </m.div>
            )}
          </AnimatePresence>
        </m.div>
      </div>

      {/* 阶段文字 */}
      <div
        style={{
          fontSize: 11,
          letterSpacing: '-0.01em',
          color: reached || isFailed
            ? 'var(--color-text-primary)'
            : 'var(--color-text-tertiary)',
          fontWeight: isCurrent ? 600 : 500,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
    </div>
  );
}

/** 底部整体进度条:渐变填充 + 进行中时的光带扫动,右侧展示百分比。 */
function OverallProgress({
  percent,
  active,
  isError,
  done,
}: {
  percent: number;
  active: boolean;
  isError: boolean;
  done: boolean;
}) {
  const trackHeight = 6;
  const barBackground = isError
    ? 'var(--color-system-red, #ff3b30)'
    : `linear-gradient(90deg, ${ACCENT_HEX} 0%, #5ac8fa 100%)`;
  const barPercent = done ? 100 : isError ? 100 : percent;

  return (
    <div
      aria-label="overall progress"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
      }}
    >
      <div
        style={{
          flex: 1,
          position: 'relative',
          height: trackHeight,
          borderRadius: trackHeight / 2,
          background: 'var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <m.div
          initial={false}
          animate={{ width: `${barPercent}%` }}
          transition={springs.smooth}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            borderRadius: trackHeight / 2,
            background: barBackground,
          }}
        />
        {/* 进行中时的光带扫动 */}
        {active && (
          <m.div
            aria-hidden
            initial={{ x: '-40%' }}
            animate={{ x: '140%' }}
            transition={{ duration: 1.8, ease: easings.easeOutExpo, repeat: Infinity }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '30%',
              height: '100%',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
      <div
        style={{
          minWidth: 44,
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 600,
          color: isError
            ? 'var(--color-system-red, #ff3b30)'
            : 'var(--color-text-primary)',
          textAlign: 'right',
        }}
      >
        {percent}%
      </div>
    </div>
  );
}
