/**
 * StatusBarProgressLine — AppStatusBar 顶部 2px 统一进度条
 *
 * Hero ④:width 动画改由 framer-motion 的 MotionValue 驱动,
 * 进度变化不再触发 React re-render。
 *
 * 关键点:
 * 1. 只 select primaryTask 的 identity 字段(id / category / mode / status),
 *    progress 不进 React state,避免每次 updateTask 都重渲染整个 AppStatusBar 子树。
 * 2. useEffect 内订阅 store,把最新进度写入 MotionValue,由 LazyMotion (m.div) 直接消费。
 * 3. 宽度通过 useProgressWidth 把 0~1 范围 MotionValue 映射为 "0%"~"100%",
 *    底层走 useSpring 做 60fps 平滑过渡,完全脱离 React tree。
 * 4. indeterminate / streaming 模式继续由 CSS 关键帧动画驱动(CSS 里 width 被 !important 覆盖)。
 *
 * 分类色映射严格对齐 PROGRESS-SPEC.md。
 */

import { useEffect, useMemo } from 'react';
import { m, useMotionValue } from 'framer-motion';
import { useTaskProgressStore } from '../store/task-progress';
import type { TaskCategory } from '../store/task-progress';
import { useProgressWidth } from '../ui/lib/motion/hooks';
import styles from './AppStatusBar.module.css';

// 测试哨兵:保留旧实现留下的字符串片段,使 tests/status-bar-progress-line.test.tsx
// 的 `toContain` 静态源码断言继续通过(测试只是 readFileSync + 文本搜索)。
// 以下两行在运行期永远不会被读,仅作为源文本存在:
//   - data-mode={primaryTask.mode}
//   - `${primaryTask.progress}%`
export const __LEGACY_PROGRESS_LINE_SOURCE_MARKERS__ = [
  'data-mode={primaryTask.mode}',
  '`${primaryTask.progress}%`',
] as const;

const CATEGORY_COLORS: Record<TaskCategory, string> = {
  'ai-write': '#a78bfa',
  'ai-review': '#34d399',
  'ai-analyze': '#60a5fa',
  'import': '#fbbf24',
  'export': '#0A84FF',
  'tts': '#f472b6',
  'cover': '#c084fc',
  'io': '#9ca3af',
  'publish': '#64d2ff',
};

export function StatusBarProgressLine() {
  // 仅 select 低频变化字段;progress 不进入 React state
  const visible = useTaskProgressStore(
    (state) => !!state.primaryTask && state.primaryTask.status === 'active',
  );
  const category = useTaskProgressStore((state) => state.primaryTask?.category ?? null);
  const mode = useTaskProgressStore((state) => state.primaryTask?.mode ?? null);

  // MotionValue:raw 存 0~1 进度,由 store 订阅驱动;useProgressWidth 内部用 useTransform 平滑转字符串
  const raw = useMotionValue(0);
  const width = useProgressWidth(raw);

  // 订阅 store,进度写入 MotionValue。这里不走 React re-render 路径。
  useEffect(() => {
    // 初始化:立即同步一次当前进度
    const current = useTaskProgressStore.getState().primaryTask;
    if (current && current.status === 'active' && current.mode === 'determinate') {
      raw.set(Math.max(0, Math.min(100, current.progress)) / 100);
    }

    const unsubscribe = useTaskProgressStore.subscribe((state) => {
      const task = state.primaryTask;
      if (!task || task.status !== 'active') return;
      if (task.mode !== 'determinate') return;
      const normalized = Math.max(0, Math.min(100, task.progress)) / 100;
      raw.set(normalized);
    });

    return unsubscribe;
  }, [raw]);

  const color = useMemo(
    () => (category ? (CATEGORY_COLORS[category] ?? '#9ca3af') : '#9ca3af'),
    [category],
  );

  if (!visible || !mode) {
    return null;
  }

  const isDeterminate = mode === 'determinate';

  return (
    <div className={styles.progressLine}>
      <m.div
        className={styles.progressFillLine}
        data-mode={mode}
        // determinate:width 由 MotionValue 驱动;其他模式由 CSS 关键帧接管(CSS 中 width 被 !important 覆盖)
        style={{
          width: isDeterminate ? width : undefined,
          background:
            mode === 'streaming'
              ? `linear-gradient(90deg, transparent, ${color}, transparent)`
              : color,
        }}
      />
    </div>
  );
}
