import { Field, FieldGrid, SummaryCard } from '../ui';
import { getFileNameFromPath } from '../lib/utils';
import styles from './ProjectOverviewPanel.module.css';

export interface ProjectOverviewMeta {
  projectName: string;
  projectPath: string;
  createdAt: number;
  sizeBytes: number;
}

interface ProjectOverviewPanelProps {
  assetCount?: number;
  overlayCount?: number;
  projectDir?: string;
  projectMeta?: ProjectOverviewMeta | null;
  timelineFps?: number;
  timelineHeight: number;
  timelineWidth: number;
  isProjectMetaLoading?: boolean;
}

export function ProjectOverviewPanel({
  assetCount = 0,
  isProjectMetaLoading = false,
  overlayCount = 0,
  projectDir = '',
  projectMeta = null,
  timelineFps = 30,
  timelineHeight,
  timelineWidth,
}: ProjectOverviewPanelProps) {
  const projectPath = projectMeta?.projectPath || projectDir;
  const projectName = projectMeta?.projectName || getFileNameFromPath(projectPath) || '未命名项目';

  return (
    <div className={styles.root} data-project-overview-root="true">
      <SummaryCard title="项目概览" meta="全局面板">
        <div className={styles.projectName}>{projectName}</div>
        <div className={styles.projectPath}>{projectPath || '未选择项目目录'}</div>
        <div className={styles.intro}>当前没有选中具体对象，右侧显示当前工程的基础信息。</div>
      </SummaryCard>

      <Field label="项目路径" hint="当前工程文件夹">
        <div className={styles.pathValue}>{projectPath || '未选择项目目录'}</div>
      </Field>

      <FieldGrid className={styles.metrics}>
        <Field label="目录大小">
          <div className={styles.metricValue}>
            {formatSize(projectMeta?.sizeBytes, isProjectMetaLoading)}
          </div>
        </Field>

        <Field label="创建时间">
          <div className={styles.metricValue}>
            {formatCreatedAt(projectMeta?.createdAt, isProjectMetaLoading)}
          </div>
        </Field>

        <Field label="分辨率">
          <div className={styles.metricValue}>{`${timelineWidth} × ${timelineHeight}`}</div>
        </Field>

        <Field label="帧率">
          <div className={styles.metricValue}>{`${timelineFps} fps`}</div>
        </Field>

        <Field label="素材数量">
          <div className={styles.metricValue}>{String(assetCount)}</div>
        </Field>

        <Field label="图层数量">
          <div className={styles.metricValue}>{String(overlayCount)}</div>
        </Field>
      </FieldGrid>
    </div>
  );
}

function formatSize(sizeBytes: number | undefined, isLoading: boolean): string {
  if (typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes >= 0) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = sizeBytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  return isLoading ? '读取中' : '暂不可用';
}

function formatCreatedAt(createdAt: number | undefined, isLoading: boolean): string {
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt <= 0) {
    return isLoading ? '读取中' : '暂不可用';
  }

  const date = new Date(createdAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
