/**
 * 依赖运行时下载的统一前端组件。
 *
 * biliup（B 站上传组件）与 chromium（自动化浏览器组件）此前在 PublishAccountsTab /
 * PublishWorkbench 各写一套几乎一致的下载 handler 与引导卡片。这里统一为：
 *   - useDependencyDownload(kind)：封装统一进度系统接入、进度映射、错误处理。
 *   - <DependencyDownloadNotice>：统一引导卡（文案 + 下载按钮 + spinner）。
 *
 * 进度兼容两种来源：biliup 走 received/total/speed（字节型），chromium 走 percent（百分比型）。
 */
import { useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Download } from 'lucide-react';
import { Button } from '../../ui';
import { Spinner } from '../../ui/primitives/Spinner';
import { useTaskProgressStore } from '../../store/task-progress';
import type { DependencyDownloadProgress } from '../../lib/electron-api';

export type DependencyKind = 'biliup' | 'chromium';

export function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(bytesPerSec / 1024))} KB/s`;
}

interface DependencyMeta {
  taskId: string;
  taskLabel: string;
  notice: string;
  buttonText: string;
}

const DEPENDENCY_META: Record<DependencyKind, DependencyMeta> = {
  biliup: {
    taskId: 'biliup-download',
    taskLabel: '下载 B 站上传组件',
    notice: 'B 站登录需要 biliup 上传组件，首次使用请先下载（约几 MB，国内已走代理加速）。',
    buttonText: '下载 B 站上传组件',
  },
  chromium: {
    taskId: 'chromium-download',
    taskLabel: '下载浏览器组件（Chromium）',
    notice:
      '抖音 / 视频号 / 小红书 / 快手发布需要浏览器组件（Chromium），首次使用请先下载（约 150MB，已走国内镜像加速）。',
    buttonText: '下载浏览器组件',
  },
};

interface DepApi {
  download: () => Promise<{ success: boolean; error?: string }>;
  onProgress: (cb: (p: DependencyDownloadProgress) => void) => () => void;
}

function apiFor(kind: DependencyKind): DepApi {
  return kind === 'biliup'
    ? {
        download: window.publishAPI.downloadBiliup,
        onProgress: window.publishAPI.onBiliupDownloadProgress,
      }
    : {
        download: window.publishAPI.downloadChromium,
        onProgress: window.publishAPI.onChromiumDownloadProgress,
      };
}

/** 把一帧下载进度映射为统一进度系统的 task patch（兼容字节型 / 百分比型）。 */
function progressToTaskPatch(p: DependencyDownloadProgress) {
  if (p.phase === 'download') {
    if (p.total && p.received != null) {
      // 进度系统约定 progress 取值 0~100；取整避免出现一长串小数
      const pct = Math.min(100, Math.round((p.received / p.total) * 100));
      return {
        mode: 'determinate' as const,
        progress: pct,
        phase: `${formatMB(p.received)} / ${formatMB(p.total)}${p.speed ? ` · ${formatSpeed(p.speed)}` : ''}`,
      };
    }
    if (typeof p.percent === 'number') {
      return {
        mode: 'determinate' as const,
        progress: Math.min(100, Math.round(p.percent)),
        phase: p.total ? `下载中 · 共 ${formatMB(p.total)}` : '下载中',
      };
    }
  }
  const phaseLabel =
    p.phase === 'resolve'
      ? '解析版本'
      : p.phase === 'extract'
        ? '解压中'
        : p.phase === 'install'
          ? '安装中'
          : '下载中';
  return { mode: 'indeterminate' as const, phase: phaseLabel };
}

export interface UseDependencyDownloadOptions {
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

/** 依赖下载逻辑（接入统一进度系统）。biliup 与 chromium 共用。 */
export function useDependencyDownload(
  kind: DependencyKind,
  { onSuccess, onError }: UseDependencyDownloadOptions = {},
) {
  const [downloading, setDownloading] = useState(false);
  const download = useCallback(async () => {
    const meta = DEPENDENCY_META[kind];
    const api = apiFor(kind);
    const { startTask, updateTask, completeTask, failTask } = useTaskProgressStore.getState();
    setDownloading(true);
    startTask({
      id: meta.taskId,
      category: 'publish',
      label: meta.taskLabel,
      mode: 'indeterminate',
      progress: 0,
      phase: '准备中',
      level: 0,
      canCancel: false,
    });
    const unsub = api.onProgress((p) => updateTask(meta.taskId, progressToTaskPatch(p)));
    try {
      const res = await api.download();
      if (res.success) {
        completeTask(meta.taskId);
        onSuccess?.();
      } else {
        failTask(meta.taskId, res.error || '下载失败');
        onError?.(res.error || '下载失败');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '下载异常';
      failTask(meta.taskId, msg);
      onError?.(msg);
    } finally {
      unsub();
      setDownloading(false);
    }
  }, [kind, onSuccess, onError]);
  return { downloading, download };
}

const cardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  padding: '12px 14px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--color-system-blue) 30%, transparent)',
  background: 'color-mix(in srgb, var(--color-system-blue) 8%, transparent)',
};

const textStyle: CSSProperties = {
  flex: 1,
  minWidth: 240,
  fontSize: 12,
  color: 'var(--color-text-secondary)',
};

export interface DependencyDownloadNoticeProps extends UseDependencyDownloadOptions {
  kind: DependencyKind;
  className?: string;
}

/** 统一的依赖下载引导卡：文案 + 下载按钮（带 spinner），接入统一进度系统。 */
export function DependencyDownloadNotice({
  kind,
  className,
  onSuccess,
  onError,
}: DependencyDownloadNoticeProps) {
  const { downloading, download } = useDependencyDownload(kind, { onSuccess, onError });
  const meta = DEPENDENCY_META[kind];
  return (
    <div className={className} style={cardStyle}>
      <span style={textStyle}>{meta.notice}</span>
      <Button
        type="button"
        size="sm"
        variant="primary"
        onClick={() => void download()}
        disabled={downloading}
        leftIcon={downloading ? <Spinner size={12} /> : <Download size={12} />}
      >
        {downloading ? '下载中…' : meta.buttonText}
      </Button>
    </div>
  );
}
