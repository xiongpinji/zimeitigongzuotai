/**
 * Motion System — 统一导出
 *
 * 使用方式:
 *   import { springs, fadeIn, MotionProvider, useMacSpring } from '@/ui/lib/motion';
 *
 * 子路径也可直接 import(用于 tree-shaking 更激进的场景):
 *   import { springs } from '@/ui/lib/motion/tokens';
 */

export * from "./tokens";
export * from "./variants";
export * from "./hooks";
export { MotionProvider } from "./provider";
