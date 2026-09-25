import type { MotionCompileResult } from '../types/motion';
import { stripCodeFences, validateCardTsx } from '../remotion/compile-card';

/**
 * 校验并规整 LLM 产出的 Remotion 卡片 TSX 源码。
 * 真正的 esbuild 编译在主进程进行；此处仅做去围栏 + 结构校验，
 * 保持 MotionCompileResult 形态以兼容现有调用方。
 */
export function compileMotionSource(source: string): MotionCompileResult {
  const tsx = stripCodeFences(source);
  const validation = validateCardTsx(tsx);
  if (!validation.ok) {
    return { success: false, error: validation.error ?? 'Motion Card TSX 校验失败' };
  }
  return { success: true, tsx };
}
