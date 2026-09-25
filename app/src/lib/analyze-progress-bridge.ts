/**
 * 字幕分析进度桥：把 `analyze-progress` 事件（planning → cards → done）
 * 映射到底部统一任务进度系统，并在 planning 单次大请求期间提供「已用时 + 脉冲」心跳。
 *
 * 背景：编辑器手动入口（AIPanel）此前用 indeterminate 无限转圈、且根本没订阅
 * `analyze-progress`，导致用户看不到 0/N 卡片整体进度、planning 1-3 分钟空白时
 * 误以为卡死。一键流水线（useAIVideoWorkflow）有 3 轨合成的定制逻辑，这里抽出的是
 * 二者共享的「订阅 + 心跳 + 文案/百分比映射」单元；workflow 的合成逻辑保持不动。
 */

export type AnalyzeProgressMode = 'determinate' | 'indeterminate' | 'streaming';

export type AnalyzeCardSubStage = 'start' | 'generating-image' | 'done' | 'failed';

export interface AnalyzeCardProgressLike {
  segmentIndex: number;
  segmentId: string;
  title?: string;
  visualType?: string;
  status: AnalyzeCardSubStage;
  error?: string;
}

export interface AnalyzeProgressLike {
  phase: 'planning' | 'cards' | 'done';
  percent: number;
  message?: string;
  cardIndex?: number;
  cardTotal?: number;
  card?: AnalyzeCardProgressLike;
}

export interface AnalyzeProgressPatch {
  progress: number;
  phase: string;
  mode: AnalyzeProgressMode;
}

const DEFAULT_PLANNING_MESSAGE = '规划分段与封面提示词…';

/** 生成给用户看的阶段文案。planning 阶段附带「已用 Xs」以表明在跑。 */
export function describeAnalyzeProgress(
  progress: AnalyzeProgressLike,
  planningElapsedSec = 0,
): string {
  if (progress.phase === 'planning') {
    const base = progress.message?.trim() || DEFAULT_PLANNING_MESSAGE;
    return planningElapsedSec > 0 ? `${base}（已用 ${planningElapsedSec}s）` : base;
  }
  if (progress.phase === 'cards') {
    if (progress.message?.trim()) return progress.message.trim();
    if (
      typeof progress.cardIndex === 'number' &&
      typeof progress.cardTotal === 'number' &&
      progress.cardTotal > 0
    ) {
      return `生成内容卡片 ${progress.cardIndex}/${progress.cardTotal}`;
    }
    return '生成内容卡片…';
  }
  return progress.message?.trim() || '内容分析完成';
}

/**
 * 把进度事件映射成统一进度补丁：
 * - planning：streaming（脉冲），百分比仍跟随事件（通常为 0）；
 * - cards / done：determinate，显示真实百分比。
 */
export function mapAnalyzeProgressToPatch(
  progress: AnalyzeProgressLike,
  planningElapsedSec = 0,
): AnalyzeProgressPatch {
  const mode: AnalyzeProgressMode = progress.phase === 'planning' ? 'streaming' : 'determinate';
  const clamped = Math.max(0, Math.min(100, Math.round(progress.percent)));
  return {
    progress: clamped,
    phase: describeAnalyzeProgress(progress, planningElapsedSec),
    mode,
  };
}

const CARD_SUBSTAGE_PHASE: Record<AnalyzeCardSubStage, string> = {
  start: '生成内容…',
  'generating-image': '生成图片…',
  done: '完成',
  failed: '失败',
};

export function cardChildTaskId(parentId: string, segmentIndex: number): string {
  return `${parentId}::card::${segmentIndex}`;
}

export interface CardChildTaskDeps {
  startTask: (input: {
    id: string;
    parentId: string;
    category: 'ai-analyze';
    label: string;
    mode: 'indeterminate';
    progress: number;
    phase: string;
    level: 1;
    canCancel: false;
  }) => void;
  updateTask: (id: string, patch: { phase: string }) => void;
  completeTask: (id: string) => void;
  failTask: (id: string, error: string) => void;
  /** 子任务是否已创建（用于幂等：并发事件可能乱序）。 */
  hasTask: (id: string) => boolean;
}

/** 把单个卡片生命周期事件落到对应子任务（按 segmentIndex 幂等路由）。 */
export function applyCardEvent(
  parentId: string,
  card: AnalyzeCardProgressLike,
  deps: CardChildTaskDeps,
): void {
  const id = cardChildTaskId(parentId, card.segmentIndex);
  const label = `卡片#${card.segmentIndex + 1}${card.title ? ` ${card.title}` : ''}`;
  if (card.status === 'done') {
    deps.completeTask(id);
    return;
  }
  if (card.status === 'failed') {
    deps.failTask(id, card.error || '卡片生成失败');
    return;
  }
  // start / generating-image
  if (!deps.hasTask(id)) {
    deps.startTask({
      id,
      parentId,
      category: 'ai-analyze',
      label,
      mode: 'indeterminate',
      progress: 0,
      phase: CARD_SUBSTAGE_PHASE[card.status],
      level: 1,
      canCancel: false,
    });
  } else {
    deps.updateTask(id, { phase: CARD_SUBSTAGE_PHASE[card.status] });
  }
}

export interface AnalyzeProgressBridgeDeps {
  /** 订阅 analyze-progress 事件，返回取消订阅函数。 */
  subscribe: (callback: (progress: AnalyzeProgressLike) => void) => () => void;
  /** 更新统一进度任务。 */
  updateTask: (id: string, patch: AnalyzeProgressPatch) => void;
  /** 注入时钟，便于测试。 */
  now?: () => number;
  /** 注入定时器，便于测试。 */
  setIntervalFn?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
  /** 心跳间隔，默认 1000ms。 */
  heartbeatMs?: number;
  /** 卡片子任务依赖：注入后，带 card 字段的事件映射为父任务下的子任务。 */
  cardTasks?: CardChildTaskDeps;
}

export interface AnalyzeProgressBridge {
  dispose: () => void;
}

/**
 * 创建进度桥：立即进入 planning 心跳，收到首个非 planning 事件后停止心跳并切换为
 * determinate 实时百分比。调用方在分析结束（成功/失败/取消）时必须 dispose()。
 *
 * 要求：对应的统一进度任务必须已经 startTask 创建，再创建本桥。
 */
export function createAnalyzeProgressBridge(
  taskId: string,
  deps: AnalyzeProgressBridgeDeps,
): AnalyzeProgressBridge {
  const now = deps.now ?? (() => Date.now());
  const setIntervalFn =
    deps.setIntervalFn ?? ((handler, ms) => setInterval(handler, ms));
  const clearIntervalFn = deps.clearIntervalFn ?? ((handle) => clearInterval(handle));
  const heartbeatMs = deps.heartbeatMs ?? 1000;

  const planningStartedAt = now();
  let inPlanning = true;
  let disposed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const planningElapsedSec = () => Math.max(0, Math.floor((now() - planningStartedAt) / 1000));

  const pushPlanningHeartbeat = () => {
    if (disposed || !inPlanning) return;
    deps.updateTask(
      taskId,
      mapAnalyzeProgressToPatch({ phase: 'planning', percent: 0 }, planningElapsedSec()),
    );
  };

  const stopHeartbeat = () => {
    if (heartbeat != null) {
      clearIntervalFn(heartbeat);
      heartbeat = null;
    }
  };

  // 立即显示「规划中」并启动心跳，避免首个事件到达前的空白。
  pushPlanningHeartbeat();
  heartbeat = setIntervalFn(pushPlanningHeartbeat, heartbeatMs);

  const unsubscribe = deps.subscribe((progress) => {
    if (disposed) return;
    if (progress.card && deps.cardTasks) {
      applyCardEvent(taskId, progress.card, deps.cardTasks);
      // card 事件不驱动父任务百分比，处理完直接返回，避免覆盖父 phase 文案
      return;
    }
    if (progress.phase !== 'planning' && inPlanning) {
      inPlanning = false;
      stopHeartbeat();
    }
    deps.updateTask(
      taskId,
      mapAnalyzeProgressToPatch(progress, inPlanning ? planningElapsedSec() : 0),
    );
  });

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopHeartbeat();
      unsubscribe();
    },
  };
}
