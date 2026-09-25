export interface MotionCardPayload {
  /**
   * Remotion 卡片源码：单文件 React/Remotion 函数组件（default export）。
   * 内存态始终填充；落盘时被剥离并写入 tsxPath 指向的独立文件。
   */
  tsx?: string;
  /**
   * 卡片源码外置文件相对路径（相对 projectDir），例：'ai-cards/<overlayId>/motionCard.tsx'。
   * 仅存在于磁盘 project.json；加载时据此读回 tsx。
   */
  tsxPath?: string;
  /**
   * @deprecated 旧 HyperFrames 片段（HTML + CSS + GSAP）。仅用于旧项目加载兼容，
   * 迁移完成后移除。新卡片请使用 tsx。
   */
  html?: string;
  /** 旧项目原始 HTML 备份，便于提示「需重新生成」。 */
  legacyHtml?: string;
  /** 旧 HTML 卡片加载后置 true，表示需要重新生成为 Remotion 卡片。 */
  needsRegeneration?: boolean;
  compiledAt: number;
  compileError?: string;
  prompt: string;
  retryCount: number;
}

export type MotionTemplateKey =
  | 'kpi-countup'
  | 'bar-chart-reveal'
  | 'ranking-stack'
  | 'before-after-compare'
  | 'step-flow-explainer'
  | 'chapter-stinger';

export interface MotionSubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
  relativeStartFrame: number;
  relativeEndFrame: number;
}

export interface MotionAssetInfo {
  name: string;
  type: 'image' | 'video' | 'audio' | 'other';
  path?: string;
}

export interface MotionCanvasSize {
  width: number;
  height: number;
}

export interface MotionCompileSuccess {
  success: true;
  /** Remotion 卡片 TSX 源码。 */
  tsx: string;
}

export interface MotionCompileFailure {
  success: false;
  error: string;
}

export type MotionCompileResult = MotionCompileSuccess | MotionCompileFailure;

export interface MotionCardResult {
  success: boolean;
  html?: string;
  error?: string;
  retryCount: number;
}

export interface MotionGenerateParams {
  prompt: string;
  durationMs?: number;
  displayMode?: 'fullscreen' | 'pip';
  canvasSize?: MotionCanvasSize;
  assets?: MotionAssetInfo[];
}

export interface MotionModifyParams {
  html: string;
  instruction: string;
}
