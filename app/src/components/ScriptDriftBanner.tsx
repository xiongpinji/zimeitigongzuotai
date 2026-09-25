import { useCallback, useEffect, useState } from 'react';
import { AppIcon } from './AppIcon';
import { Button } from '../ui';
import type { ProjectData } from '../lib/project-persistence';
import { hashScriptForPodcast } from '../lib/script-hash';
import type { WorkflowStep } from '../store/ai';
import { useScriptStore } from '../store/script';
import styles from './ScriptDriftBanner.module.css';

export interface ScriptDriftBannerProps {
  projectDir: string;
  podcastAudioPath: string;
  podcastSrtPath: string;
  workflowStep: WorkflowStep;
  /**
   * Editor 当前是否可见。切换 workspace tab 回到 Editor 时应重新检测，
   * 以便用户在 ScriptWorkbench 改过稿件后立刻看到最新状态。
   */
  isActive?: boolean;
  regenerateDisabled?: boolean;
  onRegenerate: () => void;
  /** 测试注入的加载器，便于跳过 electron API */
  loader?: ScriptDriftLoader;
}

export interface ScriptDriftLoader {
  loadScriptFile: (projectDir: string, filename: string) => Promise<string | null>;
  loadProject: (projectDir: string) => Promise<string>;
  getFileMtime: (filePath: string) => Promise<number | null>;
}

function defaultLoader(): ScriptDriftLoader | null {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return null;
  }
  return {
    loadScriptFile: window.electronAPI.loadScriptFile,
    loadProject: window.electronAPI.loadProject,
    getFileMtime: window.electronAPI.getFileMtime,
  };
}

function joinPath(projectDir: string, relative: string): string {
  if (!projectDir) return relative;
  const sep = projectDir.endsWith('/') || projectDir.endsWith('\\') ? '' : '/';
  return `${projectDir}${sep}${relative}`;
}

/**
 * 当 Editor 页处于可交互状态（workflow idle / error）、且口播音频与字幕都存在时，
 * 比对当前 script.md 的归一化哈希与上次 TTS 成功时记录的 lastPodcastScriptHash。
 * 若不一致，顶部横幅提示用户："口播文稿已修改" + 一键重新生成按钮。
 *
 * 副作用策略：
 *   - 依赖项变化时重新检测（projectDir / 音频与字幕路径 / workflow.step）。
 *   - workflow 运行中（非 idle / error）时隐藏横幅，避免与一键成片动效冲突。
 */
export function ScriptDriftBanner({
  projectDir,
  podcastAudioPath,
  podcastSrtPath,
  workflowStep,
  isActive = true,
  regenerateDisabled = false,
  onRegenerate,
  loader,
}: ScriptDriftBannerProps) {
  const [drifted, setDrifted] = useState(false);

  // 内存态优先：script-workbench 无自动保存，
  // 用户刚敲完还没 Cmd+S 就切回 Editor 时，store 中的 scriptText 才是最新内容。
  const liveScriptText = useScriptStore((s) =>
    s.projectDir === projectDir ? s.scriptText : null,
  );
  const scriptDirty = useScriptStore((s) =>
    s.projectDir === projectDir ? Boolean(s.fileDirtyMap['script.md']) : false,
  );

  useEffect(() => {
    if (!isActive) {
      // 非当前页：不主动重算，但保留上次结果，避免切回来时闪烁。
      return;
    }
    if (!projectDir || !podcastAudioPath || !podcastSrtPath) {
      setDrifted(false);
      return;
    }
    if (workflowStep !== 'idle' && workflowStep !== 'error' && workflowStep !== 'done') {
      // 流程运行中：隐藏横幅，等完成后的重新检测会更新状态
      setDrifted(false);
      return;
    }

    const api = loader ?? defaultLoader();
    if (!api) {
      setDrifted(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [projectJson, diskScriptText] = await Promise.all([
          api.loadProject(projectDir).catch(() => null),
          api.loadScriptFile(projectDir, 'script.md').catch(() => null),
        ]);
        if (cancelled) return;

        // 优先用内存态（包含尚未落盘的编辑），否则用磁盘内容
        const effectiveScriptText =
          liveScriptText !== null && liveScriptText !== undefined
            ? liveScriptText
            : (diskScriptText ?? '');

        if (!effectiveScriptText.trim()) {
          setDrifted(false);
          return;
        }

        let project: ProjectData | null = null;
        if (projectJson) {
          try {
            project = JSON.parse(projectJson) as ProjectData;
          } catch {
            project = null;
          }
        }

        const savedHash = project?.workflowMeta?.lastPodcastScriptHash ?? null;

        // 主路径：有哈希基准，直接对比内存/磁盘文稿
        if (savedHash) {
          const currentHash = hashScriptForPodcast(effectiveScriptText);
          setDrifted(currentHash !== savedHash);
          return;
        }

        // 回退路径 A：没有哈希但 store 里 script.md 已标记 dirty
        // → 说明用户在本次会话中改过稿但上一份口播之前就生成了 → 直接判漂移
        if (scriptDirty) {
          setDrifted(true);
          return;
        }

        // 回退路径 B：旧工程——对比 script.md 与口播产物的 mtime
        const [scriptMtime, audioMtime, srtMtime] = await Promise.all([
          api.getFileMtime(joinPath(projectDir, 'script.md')).catch(() => null),
          api.getFileMtime(podcastAudioPath).catch(() => null),
          api.getFileMtime(podcastSrtPath).catch(() => null),
        ]);
        if (cancelled) return;

        if (scriptMtime == null || (audioMtime == null && srtMtime == null)) {
          setDrifted(false);
          return;
        }

        const podcastMtime = Math.min(
          audioMtime ?? Number.POSITIVE_INFINITY,
          srtMtime ?? Number.POSITIVE_INFINITY,
        );
        // 留 2 秒缓冲，避免 TTS 写完 srt 后几十毫秒内写 script 的毫厘差误报
        setDrifted(scriptMtime > podcastMtime + 2000);
      } catch {
        if (!cancelled) setDrifted(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isActive,
    liveScriptText,
    loader,
    podcastAudioPath,
    podcastSrtPath,
    projectDir,
    scriptDirty,
    workflowStep,
  ]);

  const handleClick = useCallback(() => {
    if (regenerateDisabled) return;
    onRegenerate();
  }, [onRegenerate, regenerateDisabled]);

  if (!drifted) {
    return null;
  }

  return (
    <div className={styles.banner} role="status" data-testid="script-drift-banner">
      <div className={styles.iconWrap}>
        <AppIcon name="alert-circle" size={14} />
      </div>
      <div className={styles.message}>
        <span className={styles.title}>口播文稿已修改</span>
        <span className={styles.hint}>
          当前 script.md 与上次生成口播时不一致，建议重新合成音频与字幕
        </span>
      </div>
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="sm"
          onClick={handleClick}
          disabled={regenerateDisabled}
          leftIcon={<AppIcon name="refresh-cw" size={12} />}
          data-testid="script-drift-regenerate"
        >
          重新生成口播
        </Button>
      </div>
    </div>
  );
}
