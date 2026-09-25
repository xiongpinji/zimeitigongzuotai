export type WorkbenchStage =
  | 'not_started'
  | 'original_ready'
  | 'script_ready'
  | 'review_issues'
  | 'review_clean';

export type WorkbenchReviewState = 'idle' | 'pending' | 'issues' | 'clean' | 'stale';

export type WorkbenchFileReadiness = 'missing' | 'empty' | 'ready';

export interface WorkbenchStageAnnotationLike {
  status: 'pending' | 'accepted' | 'dismissed';
  stale?: boolean;
}

export interface WorkbenchStageContext {
  workspaceFiles: {
    hasOriginalFile: boolean;
    hasScriptFile: boolean;
  };
  originalText: string;
  scriptText: string;
  reviewState: WorkbenchReviewState;
  annotations: WorkbenchStageAnnotationLike[];
  manualStageOverride?: WorkbenchStage | null;
}

export const WORKBENCH_STAGE_LABELS: Record<WorkbenchStage, string> = {
  not_started: '未开始',
  original_ready: '原稿阶段',
  script_ready: '口播稿阶段',
  review_issues: '审查有问题',
  review_clean: '审查完成',
};

export function getFileReadiness(
  hasFile: boolean,
  content: string,
): WorkbenchFileReadiness {
  if (content.trim()) return 'ready';
  if (!hasFile) return 'missing';
  return 'empty';
}

export function deriveAutoWorkbenchStage(
  context: Omit<WorkbenchStageContext, 'manualStageOverride'>,
): WorkbenchStage {
  const originalReadiness = getFileReadiness(
    context.workspaceFiles.hasOriginalFile,
    context.originalText,
  );
  const scriptReadiness = getFileReadiness(
    context.workspaceFiles.hasScriptFile,
    context.scriptText,
  );
  const hasActionableAnnotations = context.annotations.some(
    (annotation) => annotation.status === 'pending' && !annotation.stale,
  );

  if (scriptReadiness === 'ready') {
    if (context.reviewState === 'clean') return 'review_clean';
    if (context.reviewState === 'issues' && hasActionableAnnotations) {
      return 'review_issues';
    }
    return 'script_ready';
  }

  if (originalReadiness !== 'missing') {
    return 'original_ready';
  }

  return 'not_started';
}

export function deriveEffectiveWorkbenchStage(
  context: WorkbenchStageContext,
): WorkbenchStage {
  return context.manualStageOverride ?? deriveAutoWorkbenchStage(context);
}

export function selectAutoWorkbenchStage(state: WorkbenchStageContext): WorkbenchStage {
  return deriveAutoWorkbenchStage(state);
}

export function selectEffectiveWorkbenchStage(
  state: WorkbenchStageContext,
): WorkbenchStage {
  return deriveEffectiveWorkbenchStage(state);
}

export function selectOriginalFileReadiness(
  state: WorkbenchStageContext,
): WorkbenchFileReadiness {
  return getFileReadiness(state.workspaceFiles.hasOriginalFile, state.originalText);
}

export function selectScriptFileReadiness(
  state: WorkbenchStageContext,
): WorkbenchFileReadiness {
  return getFileReadiness(state.workspaceFiles.hasScriptFile, state.scriptText);
}
