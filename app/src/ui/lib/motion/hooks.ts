/**
 * Motion Hooks — 常用封装
 *
 * 提供若干高频场景的 hook,避免每次在业务层重复引用 tokens + useReducedMotion + useMotionValue。
 */

import {
	useMotionValue,
	useReducedMotion,
	useSpring,
	useTransform,
	type MotionValue,
	type SpringOptions,
	type Transition,
} from "framer-motion";
import { useEffect } from "react";
import { springs, type SpringToken } from "./tokens";

/**
 * 取一个 spring token,自动响应 prefers-reduced-motion
 *
 * 用户开启减少动效时返回 0 duration tween(瞬切),否则返回对应的弹簧参数。
 */
export function useMacSpring(key: SpringToken = "smooth"): Transition {
	const shouldReduce = useReducedMotion();
	if (shouldReduce) {
		return { duration: 0 };
	}
	return springs[key];
}

/**
 * 追踪一个数值变化,用 spring 平滑过渡,不触发 React re-render
 *
 * 场景:
 * - 时间轴 playhead 位置
 * - AppStatusBar 顶部进度条(0~1)
 * - 音量/缩放滑块
 *
 * @example
 * const progress = useSmoothValue(externalProgress, { stiffness: 120, damping: 24 });
 * return <m.div style={{ scaleX: progress }} />;
 */
export function useSmoothValue(
	target: number,
	options: SpringOptions = { stiffness: 200, damping: 30, mass: 1 },
): MotionValue<number> {
	const raw = useMotionValue(target);
	const smoothed = useSpring(raw, options);
	useEffect(() => {
		raw.set(target);
	}, [target, raw]);
	return smoothed;
}

/**
 * 将 0~1 的进度 MotionValue 转为 "0%"~"100%" 的 width 字符串
 *
 * 搭配 useSmoothValue 使用,驱动进度条宽度。
 *
 * @example
 * const progress = useSmoothValue(taskProgress);
 * const width = useProgressWidth(progress);
 * return <m.div style={{ width }} className="h-[2px] bg-mac-blue" />;
 */
export function useProgressWidth(
	progress: MotionValue<number>,
): MotionValue<string> {
	return useTransform(progress, [0, 1], ["0%", "100%"]);
}

/**
 * 快捷判断:当前环境是否启用动画
 *
 * 用于条件渲染(比如某些大面积装饰动画在减少动效时直接不渲染)。
 */
export function useMotionEnabled(): boolean {
	const shouldReduce = useReducedMotion();
	return !shouldReduce;
}
