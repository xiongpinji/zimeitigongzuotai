import { FileAudio, FileVideo, Link2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Field,
  Progress,
  Textarea,
} from '../../ui';
import { PillGroup } from '../../ui/patterns';
import type {
  VideoImportProgress,
  VideoImportResult,
  VideoImportSourceInput,
} from '../../lib/video-import-types';
import { getFileNameFromPath, toFileSrc } from '../../lib/utils';
import { getDroppedFilePath } from '../../lib/import-files';
import styles from './DouyinImportDialog.module.css';

type ImportMode = 'douyin' | 'local_video' | 'local_audio';

const LOCAL_MEDIA_EXTENSIONS: Record<'local_video' | 'local_audio', string[]> = {
  local_video: ['.mp4', '.mov', '.webm', '.m4v'],
  local_audio: ['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', '.opus'],
};

const IMPORT_MODE_ITEMS = [
  { value: 'douyin', label: '抖音链接' },
  { value: 'local_video', label: '本地视频' },
  { value: 'local_audio', label: '本地音频' },
] satisfies Array<{ value: ImportMode; label: string }>;

interface DouyinImportDialogProps {
  open: boolean;
  busy: boolean;
  progress: VideoImportProgress | null;
  lastResult: VideoImportResult | null;
  errorMessage: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (source: VideoImportSourceInput) => Promise<void>;
  onOpenPreview?: () => void;
}

export function DouyinImportDialog({
  open,
  busy,
  progress,
  lastResult,
  errorMessage,
  onOpenChange,
  onSubmit,
  onOpenPreview,
}: DouyinImportDialogProps) {
  const [mode, setMode] = useState<ImportMode>('douyin');
  const [url, setUrl] = useState('');
  const [filePath, setFilePath] = useState('');
  const [localFileError, setLocalFileError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const hasCompletedImport = Boolean(lastResult) && !busy;
  const canSubmit = (mode === 'douyin' ? Boolean(url.trim()) : Boolean(filePath.trim())) && !busy;
  const localMode = mode === 'local_video' || mode === 'local_audio' ? mode : null;
  const acceptedExtensions = useMemo(
    () => (localMode ? LOCAL_MEDIA_EXTENSIONS[localMode] : []),
    [localMode],
  );
  const isAudioOnlyResult = lastResult?.sourceType === 'local_audio';
  const lastSourceLabel = lastResult?.sourceType === 'local_audio'
    ? '音频 ID'
    : lastResult?.sourceType === 'local_video'
      ? '视频 ID'
      : '视频 ID';

  useEffect(() => {
    if (!open) {
      setUrl('');
      setFilePath('');
      setLocalFileError(null);
      setDragActive(false);
      setMode('douyin');
    }
  }, [open]);

  const validateLocalFilePath = (nextPath: string): string | null => {
    if (!localMode) return null;
    const lower = nextPath.toLowerCase();
    if (acceptedExtensions.some((extension) => lower.endsWith(extension))) {
      return null;
    }
    return `请导入 ${acceptedExtensions.join(' / ')} 文件。`;
  };

  const applyLocalFilePath = (nextPath: string) => {
    const error = validateLocalFilePath(nextPath);
    setLocalFileError(error);
    if (!error) {
      setFilePath(nextPath);
    }
  };

  const handleSelectLocalFile = async () => {
    if (!localMode) return;
    const selected = await window.electronAPI.selectMediaFile(
      mode === 'local_video' ? 'video' : 'audio',
    );
    if (selected) {
      applyLocalFilePath(selected);
    }
  };

  const handleLocalDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!localMode || busy || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  };

  const handleLocalDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setDragActive(false);
  };

  const handleLocalDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!localMode || busy) return;
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
    if (!file) return;
    const nextPath = getDroppedFilePath(file, window.electronAPI.getPathForFile);
    if (!nextPath) {
      setLocalFileError('无法读取拖入文件路径，请改用选择文件。');
      return;
    }
    applyLocalFilePath(nextPath);
  };

  const handleSubmit = () => {
    if (mode === 'douyin') {
      void onSubmit({ sourceType: 'douyin', url: url.trim() });
      return;
    }
    const error = validateLocalFilePath(filePath.trim());
    if (error) {
      setLocalFileError(error);
      return;
    }
    void onSubmit({ sourceType: mode, filePath: filePath.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogClose />
        <DialogHeader>
          <DialogTitle>导入媒体</DialogTitle>
          <DialogDescription>
            支持抖音链接、本地视频和本地音频，系统会自动转换音频并转录为当前项目的
            `original.md`。
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className={styles.shell}>
            <PillGroup
              fullWidth
              wrap={false}
              size="sm"
              className={styles.sourceTabs}
              items={IMPORT_MODE_ITEMS.map((item) => ({ ...item, disabled: busy }))}
              value={mode}
              onChange={(value) => {
                setMode(value);
                setFilePath('');
                setLocalFileError(null);
                setDragActive(false);
              }}
            />

            {mode === 'douyin' ? (
              <div className={styles.sourcePane}>
                <Field label="视频链接">
                  <div className={styles.linkBox}>
                    <Textarea
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://v.douyin.com/..."
                      rows={4}
                    />
                  </div>
                </Field>
              </div>
            ) : (
              <Field label={mode === 'local_video' ? '视频文件' : '音频文件'}>
                <div
                  className={`${styles.filePicker} ${dragActive ? styles.filePickerActive : ''}`}
                  onDragEnter={handleLocalDragOver}
                  onDragOver={handleLocalDragOver}
                  onDragLeave={handleLocalDragLeave}
                  onDrop={handleLocalDrop}
                >
                  <div className={`${styles.fileIcon} ${filePath ? styles.fileIconFilled : ''}`}>
                    {mode === 'local_video' ? <FileVideo size={17} /> : <FileAudio size={17} />}
                  </div>
                  <div className={styles.fileInfo}>
                    <div className={styles.fileName}>
                      {filePath
                        ? getFileNameFromPath(filePath)
                        : dragActive
                          ? '松开导入文件'
                          : mode === 'local_video'
                            ? '选择或拖入视频文件'
                            : '选择或拖入音频文件'}
                    </div>
                    <div className={styles.fileHint}>
                      {filePath || acceptedExtensions.join(' / ')}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleSelectLocalFile}
                    disabled={busy}
                    leftIcon={<Upload size={13} />}
                  >
                    {filePath ? '更换' : '选择'}
                  </Button>
                </div>
                {localFileError ? (
                  <div className={styles.errorText}>{localFileError}</div>
                ) : null}
              </Field>
            )}

            {/* 导入进度：标签 + 进度条 + 状态文本 */}
            {progress ? (
              <div className={styles.progressBox}>
                {/* 步骤标签行：左侧步骤名，右侧百分比 */}
                <div className={styles.progressHeader}>
                  <span className={styles.progressLabel}>{progress.stepLabel}</span>
                  <span className={styles.progressPercent}>{progress.progress}%</span>
                </div>
                {/* 进度条 */}
                <Progress
                  value={progress.progress}
                  size="sm"
                  variant={progress.status === 'done' ? 'success' : 'default'}
                />
                {/* 状态文本 */}
                <div className={styles.statusText}>
                  {progress.status === 'downloading' && '正在准备媒体…'}
                  {progress.status === 'extracting_audio' && '正在提取音频…'}
                  {progress.status === 'transcribing' && '正在转录字幕…'}
                  {progress.status === 'syncing' && '正在同步到项目…'}
                  {progress.status === 'done' && '导入完成'}
                  {progress.status === 'error' && '导入失败'}
                </div>
              </div>
            ) : null}

            {lastResult ? (
              <div className={styles.resultBox}>
                <div className={styles.resultHeader}>
                  <div>
                    <p className={styles.resultTitle}>最近一次导入：{lastResult.title}</p>
                    <div className={styles.resultSubtitle}>已写入 {lastResult.transcriptPath}</div>
                  </div>
                </div>

                {isAudioOnlyResult ? (
                  <audio
                    className={styles.audioPreview}
                    controls
                    preload="metadata"
                    src={toFileSrc(lastResult.audioPath)}
                  />
                ) : (
                  <div className={styles.previewFrame}>
                    <video
                      className={styles.videoPreview}
                      controls
                      preload="metadata"
                      src={toFileSrc(lastResult.videoPath)}
                    />
                  </div>
                )}

                <div className={styles.metaGrid}>
                  <span className={styles.metaLabel}>{lastSourceLabel}</span>
                  <span className={styles.metaValue}>{lastResult.videoId}</span>
                  <span className={styles.metaLabel}>来源</span>
                  <span className={styles.metaValue}>
                    {lastResult.sourceUrl ?? lastResult.sourcePath ?? '本地媒体'}
                  </span>
                  <span className={styles.metaLabel}>预览文件</span>
                  <span className={styles.metaValue}>
                    {getFileNameFromPath(lastResult.previewMetadataPath)}
                  </span>
                </div>

                <div className={styles.resultActions}>
                  <Button
                    variant="ghost"
                    onClick={() => window.electronAPI.showItemInFolder(lastResult.videoPath)}
                    leftIcon={<Link2 size={13} />}
                  >
                    查看目录
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => onOpenPreview?.()}
                    disabled={!onOpenPreview}
                  >
                    打开预览
                  </Button>
                </div>
              </div>
            ) : null}

            {errorMessage ? (
              <Alert variant="error">{errorMessage}</Alert>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {hasCompletedImport ? '立即关闭' : '取消'}
          </Button>
          {hasCompletedImport && !canSubmit ? (
            <Button
              variant="secondary"
              onClick={() => onOpenPreview?.()}
              disabled={!onOpenPreview}
            >
              打开预览
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {busy ? '导入中…' : hasCompletedImport ? '再次导入' : '开始导入'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
