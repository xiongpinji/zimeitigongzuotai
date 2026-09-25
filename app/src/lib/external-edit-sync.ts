import { routeExternalEdit } from './external-edit-route';
import { useTimelineStore } from '../store/timeline';
import type { TimelineData } from '../types';

export interface ExternalEditDeps {
  /** 重新加载整个项目（用于 project.json 变更后热重载 timeline） */
  loadProject: (projectDir: string) => Promise<{ timeline: TimelineData | null }>;
  projectDir: string;
  /** 把外部 motionCard.tsx 源码灌回对应 overlay */
  applyCardSource: (overlayId: string, tsx: string) => void;
  /** script.md / original.md 变更钩子（Task 12 接入灌回 + 版本历史） */
  onScriptChanged: (kind: 'script' | 'original', content: string) => void;
}

/**
 * 将来自 main 的外部文件变更（file-changed）按类型分流应用到 Renderer store。
 * - project.json → 重载并替换 timeline
 * - motionCard.tsx → 替换该卡内存源码触发预览重编译
 * - script.md / original.md → 留钩子给 Task 12
 */
export async function handleExternalEdit(
  evt: { file: string; content: string },
  deps: ExternalEditDeps,
): Promise<void> {
  const route = routeExternalEdit(evt.file);
  switch (route.kind) {
    case 'project': {
      const { timeline } = await deps.loadProject(deps.projectDir);
      if (timeline) {
        useTimelineStore.getState().applyExternalTimeline(timeline);
      }
      break;
    }
    case 'motion-card': {
      deps.applyCardSource(route.overlayId, evt.content);
      break;
    }
    case 'script':
    case 'original': {
      deps.onScriptChanged(route.kind, evt.content);
      break;
    }
    default:
      break;
  }
}
