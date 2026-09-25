/**
 * MotionProvider — 根级 Motion 上下文
 *
 * 必须挂在 App 根节点,提供两件事:
 *
 * 1. LazyMotion + domMax:
 *    - 减少 bundle 体积(相比全量 motion.* 约 34KB → ~12KB gzipped)
 *    - `domMax` 相比 `domAnimation` 多了 layout/layoutId/drag 的完整支持
 *    - 选择 `domMax` 的原因:macOS 风格大量依赖共享元素过渡(Tabs 滑动指示器、
 *      页面路由 layoutId 共享元素、卡片吸附等签名时刻),没有 layout feature
 *      就丧失了"macOS 原生感"的核心能力。多付出的 ~6KB 物有所值。
 *    - `strict` 模式强制使用 `m.*` 而非 `motion.*`,防止退化
 *
 * 2. MotionConfig:
 *    - `reducedMotion="user"` 统一响应系统偏好(macOS "Reduce motion")
 *    - 默认 transition 对齐 Apple 默认曲线
 *
 * 使用:
 *   // src/main.tsx
 *   createRoot(...).render(
 *     <MotionProvider>
 *       <App />
 *     </MotionProvider>
 *   );
 *
 * 启用 strict 后,全项目必须用 `m.div` / `m.button` 等,不能再用 `motion.div`。
 * 这是故意的:防止未来有人退化到全量 motion 增加 bundle。
 */

import { LazyMotion, MotionConfig, domMax } from "framer-motion";
import type { ReactNode } from "react";
import { durations, easings } from "./tokens";

interface MotionProviderProps {
	children: ReactNode;
}

export function MotionProvider({ children }: MotionProviderProps) {
	return (
		<LazyMotion features={domMax} strict>
			<MotionConfig
				reducedMotion="user"
				transition={{ duration: durations.base, ease: easings.apple }}
			>
				{children}
			</MotionConfig>
		</LazyMotion>
	);
}
