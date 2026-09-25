const DEFAULT_EXPORT = /export\s+default\b/;

export function stripCodeFences(src: string): string {
  return src
    .trim()
    .replace(/^```(?:tsx|jsx|ts|js)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * 判断卡片源码是否真的会渲染出画面（含 JSX 标签）。
 * 用于预览侧兜底：旧工程里若存了只搭骨架 / return null 的不完整组件，
 * 它能通过 esbuild 编译但渲染为空白（黑屏），这里识别后回退到占位卡片而非全黑。
 */
export function hasRenderableJsx(src: string): boolean {
  return /<[A-Za-z][^>]*\/?>/.test(stripCodeFences(src));
}

export interface CardValidation {
  ok: boolean;
  error?: string;
}

/**
 * 对 LLM 产出的 Remotion 卡片 TSX 做轻量结构校验。
 * 真正的 esbuild 编译发生在主进程（electron/remotion/compile-card-node.ts），
 * 这里只做去围栏 + 必要约定检查，便于纯函数单测。
 */
export function validateCardTsx(src: string): CardValidation {
  const code = stripCodeFences(src);
  if (!code) return { ok: false, error: 'Motion Card TSX 不能为空' };
  if (!DEFAULT_EXPORT.test(code)) {
    return { ok: false, error: 'Motion Card 必须有 default export 的 Remotion 组件' };
  }
  return { ok: true };
}
