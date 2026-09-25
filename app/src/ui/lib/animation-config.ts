/**
 * Darwin UI Animation Configuration (Legacy API — 兼容层)
 *
 * ⚠️ 新代码请直接使用 `src/ui/lib/motion/tokens.ts` 的 `durations` / `springs` 常量,
 * 以及 <MotionProvider> 提供的全局 reduced-motion 响应。
 *
 * 本文件保留是为了让已经引用 `getDuration` / `getSpring` / `getTransition` 的旧组件
 * 无感迁移。2026-04 升级:参数已按 macOS 原生感标准校准(见下方注释)。
 */

export type DurationKey = "instant" | "fast" | "normal" | "slow" | "reveal";
export type SpringKey = "snappy" | "smooth" | "gentle";

export interface SpringConfig {
	type: "spring";
	stiffness: number;
	damping: number;
}

export interface AnimationConfig {
	/** Master switch to enable/disable all animations */
	enabled: boolean;

	/** Duration presets in seconds */
	durations: Record<DurationKey, number>;

	/** Spring animation presets */
	springs: Record<SpringKey, SpringConfig>;

	/** Disable specific animation types */
	disable: {
		/** Disable hover animations (whileHover) */
		hover: boolean;
		/** Disable entrance/mount animations */
		entrance: boolean;
		/** Disable exit/unmount animations */
		exit: boolean;
		/** Disable scale transforms */
		scale: boolean;
	};
}

/**
 * Default animation configuration
 * Can be modified at runtime to change animation behavior globally
 */
export const ANIMATION_CONFIG: AnimationConfig = {
	enabled: true,

	// 参数已按 macOS 原生感标准校准(2026-04 升级)
	// 对应 motion/tokens.ts 的 durations token
	durations: {
		instant: 0.1, // 原 0 → 0.1,保留感知阈值
		fast: 0.18, // 原 0.1 → 0.18(hover/focus 反馈)
		normal: 0.26, // 原 0.15 → 0.26(panel/tab)
		slow: 0.36, // 原 0.2 → 0.36(modal/sheet)
		reveal: 0.48, // 原 0.4 → 0.48(页面级 layout)
	},

	// 参数已按 Apple CAAnimation 复刻(2026-04 升级)
	// 关键改动:全部 critically-damped,避免 1 帧抖动
	springs: {
		// snappy: whileTap / 点击反馈(原 400/25 欠阻尼 → 500/44)
		snappy: { type: "spring", stiffness: 500, damping: 44 },
		// smooth: 抽屉 / 折叠(原 200/25 → 260/32)
		smooth: { type: "spring", stiffness: 260, damping: 32 },
		// gentle: sheet / modal(原 120/20 → 170/26)
		gentle: { type: "spring", stiffness: 170, damping: 26 },
	},

	disable: {
		hover: false,
		entrance: false,
		exit: false,
		scale: false,
	},
};

/**
 * Check if user prefers reduced motion
 * Returns true if the user has enabled "Reduce motion" in their OS settings
 */
export function prefersReducedMotion(): boolean {
	if (typeof window === "undefined") return false;
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Get duration value respecting reduced motion preference
 * Returns 0 if animations are disabled or user prefers reduced motion
 */
export function getDuration(key: DurationKey): number {
	if (!ANIMATION_CONFIG.enabled || prefersReducedMotion()) return 0;
	return ANIMATION_CONFIG.durations[key];
}

/**
 * Get spring config respecting reduced motion preference
 * Returns instant spring (high stiffness, high damping) if reduced motion is preferred
 */
export function getSpring(key: SpringKey): SpringConfig {
	if (!ANIMATION_CONFIG.enabled || prefersReducedMotion()) {
		return { type: "spring", stiffness: 1000, damping: 100 };
	}
	return ANIMATION_CONFIG.springs[key];
}

/**
 * Check if a specific animation type is enabled
 */
export function isAnimationEnabled(
	type: keyof AnimationConfig["disable"],
): boolean {
	if (!ANIMATION_CONFIG.enabled || prefersReducedMotion()) return false;
	return !ANIMATION_CONFIG.disable[type];
}

/**
 * Get transition object for Framer Motion
 * Respects reduced motion and disabled animation types
 */
export function getTransition(
	duration: DurationKey = "normal",
): { duration: number } {
	return { duration: getDuration(duration) };
}

/**
 * Configure animations globally
 * Call this early in your app to customize animation behavior
 *
 * @example
 * // Disable all hover animations
 * configureAnimations({ disable: { hover: true } });
 *
 * // Speed up all animations
 * configureAnimations({
 *   durations: { fast: 0.05, normal: 0.1, slow: 0.15 }
 * });
 *
 * // Disable all animations
 * configureAnimations({ enabled: false });
 */
export function configureAnimations(
	config: Partial<AnimationConfig>,
): void {
	if (config.enabled !== undefined) {
		ANIMATION_CONFIG.enabled = config.enabled;
	}
	if (config.durations) {
		Object.assign(ANIMATION_CONFIG.durations, config.durations);
	}
	if (config.springs) {
		Object.assign(ANIMATION_CONFIG.springs, config.springs);
	}
	if (config.disable) {
		Object.assign(ANIMATION_CONFIG.disable, config.disable);
	}
}
