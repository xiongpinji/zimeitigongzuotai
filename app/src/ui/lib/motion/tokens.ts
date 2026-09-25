/**
 * Motion Tokens — macOS 原生感动画参数
 *
 * 单一来源:所有 framer-motion 动画应从这里取参数,不要在组件内硬编码。
 *
 * 设计原则:
 * 1. 参数复刻 Apple CAAnimation,避免 bounce/elastic(Big Sur 后 Apple 自己也弃用)
 * 2. duration 最短 180ms(低于此值用户视觉暂留不足,感觉像瞬移而非动画)
 * 3. spring 必须 critically-damped 或过阻尼(damping / stiffness ≥ 0.08)
 * 4. 不在这一层判断 prefers-reduced-motion,由 MotionConfig 统一接管
 *
 * 与 src/ui/lib/animation-config.ts 的关系:
 * - animation-config 是老 API,保留兼容,其参数也已按本文件修正
 * - 新代码应直接从 `@/ui/lib/motion` 导入本文件的 token
 */

import type { Easing, Transition } from "framer-motion";

// ============================================================================
// Easings — Apple 系统曲线
// ============================================================================

export const easings = {
	/** Apple 默认曲线,适用于 hover / focus 等快速反馈 */
	apple: [0.25, 0.1, 0.25, 1] as const,
	/** expoOut,适用于 modal / sheet 退场 */
	expoOut: [0.16, 1, 0.3, 1] as const,
	/** ease-out-expo(Apple 变体),适用于 panel / tab 切换 */
	easeOutExpo: [0.32, 0.72, 0, 1] as const,
	/** quart-out,最精致的减速 */
	quartOut: [0.25, 1, 0.5, 1] as const,
} as const satisfies Record<string, Easing>;

// ============================================================================
// Durations — 秒(framer-motion 约定单位)
// ============================================================================

export const durations = {
	/** 100ms 状态瞬切(selected / active 切换) */
	instant: 0.1,
	/** 180ms hover / focus 反馈 */
	fast: 0.18,
	/** 260ms 面板 / tab 切换 */
	base: 0.26,
	/** 360ms modal / sheet 进入 */
	smooth: 0.36,
	/** 480ms 页面级 layout 过渡 */
	deliberate: 0.48,
} as const;

export type DurationToken = keyof typeof durations;

// ============================================================================
// Springs — 物理弹簧,复刻 macOS 系统动画
// ============================================================================

export const springs = {
	/** popover / dropdown / tooltip — 快速弹出 */
	swift: { type: "spring", stiffness: 420, damping: 38, mass: 1 },
	/** whileTap / segmented control — 点击反馈 */
	snappy: { type: "spring", stiffness: 500, damping: 44, mass: 1 },
	/** 抽屉 / 折叠 / inspector 切换 — 温和推进 */
	smooth: { type: "spring", stiffness: 260, damping: 32, mass: 1 },
	/** sheet 从顶滑入 / modal 进入 — 柔和 */
	gentle: { type: "spring", stiffness: 170, damping: 26, mass: 1 },
	/** Dock 风格 hover 放大(仅用于显著交互元素) */
	dock: { type: "spring", stiffness: 320, damping: 18, mass: 0.8 },
	/** 页面级共享元素 morph(layoutId) */
	layout: { type: "spring", stiffness: 300, damping: 34, mass: 1 },
} as const satisfies Record<string, Transition>;

export type SpringToken = keyof typeof springs;

// ============================================================================
// Transitions — 常用 transition 组合
// ============================================================================

export const transitions = {
	/** hover / focus 反馈 */
	hover: { duration: durations.fast, ease: easings.apple },
	/** panel / tab 切换 */
	panel: { duration: durations.base, ease: easings.easeOutExpo },
	/** modal / sheet 进入 */
	sheet: springs.gentle,
	/** popover / dropdown 弹出 */
	pop: springs.swift,
	/** whileTap 点击 */
	tap: springs.snappy,
	/** 折叠 / 抽屉 */
	drawer: springs.smooth,
	/** 共享元素 layout */
	sharedLayout: springs.layout,
} as const satisfies Record<string, Transition>;

// ============================================================================
// Stagger — 列表渐次出现
// ============================================================================

export const stagger = {
	/** 小列表(≤ 12 项)单项间隔 */
	tight: 0.035,
	/** 常规列表 */
	normal: 0.05,
	/** 突出节奏感 */
	loose: 0.08,
} as const;

// ============================================================================
// Types — 导出方便外部引用
// ============================================================================

export type EasingToken = keyof typeof easings;
