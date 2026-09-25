/**
 * Motion Variants — 预设动画变体库
 *
 * 覆盖 90% 场景:进出场、抽屉、sheet、popover、列表 stagger、共享元素。
 * 所有 variant 都使用 tokens.ts 的 duration/easing/spring,不要在业务层写死数字。
 *
 * 用法:
 *   <m.div variants={fadeIn} initial="hidden" animate="visible" exit="exit" />
 *
 * 如需自定义参数,克隆后覆盖特定字段,不要直接修改本文件。
 */

import type { Variants } from "framer-motion";
import { durations, easings, springs, stagger } from "./tokens";

// ============================================================================
// 1. fadeIn — 温和淡入(最通用)
// ============================================================================
export const fadeIn: Variants = {
	hidden: { opacity: 0 },
	visible: {
		opacity: 1,
		transition: { duration: durations.base, ease: easings.apple },
	},
	exit: {
		opacity: 0,
		transition: { duration: durations.fast, ease: easings.apple },
	},
};

// ============================================================================
// 2. slideUp — 从下往上淡入(列表项、卡片、toast)
// ============================================================================
export const slideUp: Variants = {
	hidden: { opacity: 0, y: 12 },
	visible: {
		opacity: 1,
		y: 0,
		transition: springs.smooth,
	},
	exit: {
		opacity: 0,
		y: 8,
		transition: { duration: durations.fast, ease: easings.apple },
	},
};

// ============================================================================
// 3. slideDown — 从上往下淡入(dropdown、notification)
// ============================================================================
export const slideDown: Variants = {
	hidden: { opacity: 0, y: -12 },
	visible: {
		opacity: 1,
		y: 0,
		transition: springs.smooth,
	},
	exit: {
		opacity: 0,
		y: -8,
		transition: { duration: durations.fast, ease: easings.apple },
	},
};

// ============================================================================
// 4. scaleIn — 居中缩放淡入(小 tooltip / 徽章)
// ============================================================================
export const scaleIn: Variants = {
	hidden: { opacity: 0, scale: 0.92 },
	visible: {
		opacity: 1,
		scale: 1,
		transition: springs.swift,
	},
	exit: {
		opacity: 0,
		scale: 0.92,
		transition: { duration: durations.fast, ease: easings.apple },
	},
};

// ============================================================================
// 5. drawerRight — 右侧抽屉(AIPanel / AgentSidebar / SideDrawer)
// ============================================================================
export const drawerRight: Variants = {
	hidden: { opacity: 0, x: "100%" },
	visible: {
		opacity: 1,
		x: 0,
		transition: springs.smooth,
	},
	exit: {
		opacity: 0,
		x: "100%",
		transition: { duration: durations.base, ease: easings.easeOutExpo },
	},
};

// ============================================================================
// 6. drawerLeft — 左侧抽屉(文件树 / 资源面板)
// ============================================================================
export const drawerLeft: Variants = {
	hidden: { opacity: 0, x: "-100%" },
	visible: {
		opacity: 1,
		x: 0,
		transition: springs.smooth,
	},
	exit: {
		opacity: 0,
		x: "-100%",
		transition: { duration: durations.base, ease: easings.easeOutExpo },
	},
};

// ============================================================================
// 7. sheetFromTop — macOS sheet(modal/ExportSettingsModal)
// ============================================================================
export const sheetFromTop: Variants = {
	hidden: {
		opacity: 0,
		y: -24,
		scale: 0.98,
	},
	visible: {
		opacity: 1,
		y: 0,
		scale: 1,
		transition: springs.gentle,
	},
	exit: {
		opacity: 0,
		y: -16,
		scale: 0.98,
		transition: { duration: durations.base, ease: easings.easeOutExpo },
	},
};

// ============================================================================
// 8. popoverScale — dropdown / context-menu / select 的展开
// 特点:scaleY 从顶部原点展开,带方向感
// 注意:使用时记得设置 style={{ transformOrigin: 'top' }}
// ============================================================================
export const popoverScale: Variants = {
	hidden: {
		opacity: 0,
		scaleY: 0.9,
		y: -4,
	},
	visible: {
		opacity: 1,
		scaleY: 1,
		y: 0,
		transition: springs.swift,
	},
	exit: {
		opacity: 0,
		scaleY: 0.9,
		y: -4,
		transition: { duration: durations.fast, ease: easings.apple },
	},
};

// ============================================================================
// 9. modalBackdrop — backdrop 模糊淡入(配 sheetFromTop 使用)
// ============================================================================
export const modalBackdrop: Variants = {
	hidden: {
		opacity: 0,
		backdropFilter: "blur(0px)",
	},
	visible: {
		opacity: 1,
		backdropFilter: "blur(20px) saturate(180%)",
		transition: { duration: durations.smooth, ease: easings.expoOut },
	},
	exit: {
		opacity: 0,
		backdropFilter: "blur(0px)",
		transition: { duration: durations.base, ease: easings.easeOutExpo },
	},
};

// ============================================================================
// 10. listStagger — 列表容器(开启 staggerChildren)
// 搭配 listStaggerItem 使用
// ============================================================================
export const listStagger: Variants = {
	hidden: {},
	visible: {
		transition: {
			staggerChildren: stagger.normal,
			delayChildren: 0.02,
		},
	},
	exit: {
		transition: {
			staggerChildren: stagger.tight,
			staggerDirection: -1,
		},
	},
};

export const listStaggerItem: Variants = {
	hidden: { opacity: 0, y: 8 },
	visible: {
		opacity: 1,
		y: 0,
		transition: { duration: durations.base, ease: easings.apple },
	},
	exit: {
		opacity: 0,
		y: -4,
		transition: { duration: durations.fast, ease: easings.apple },
	},
};

// ============================================================================
// 11. collapse — 折叠/展开(accordion / file tree)
// 注意:height 动画有重排成本,仅用于少量元素
// ============================================================================
export const collapse: Variants = {
	hidden: { height: 0, opacity: 0, overflow: "hidden" },
	visible: {
		height: "auto",
		opacity: 1,
		overflow: "hidden",
		transition: springs.smooth,
	},
	exit: {
		height: 0,
		opacity: 0,
		overflow: "hidden",
		transition: { duration: durations.base, ease: easings.easeOutExpo },
	},
};

// ============================================================================
// 12. crossfade — 页面级交叉淡入(App 路由切换)
// ============================================================================
export const crossfade: Variants = {
	hidden: { opacity: 0 },
	visible: {
		opacity: 1,
		transition: { duration: durations.base, ease: easings.apple },
	},
	exit: {
		opacity: 0,
		transition: { duration: durations.fast, ease: easings.apple },
	},
};
