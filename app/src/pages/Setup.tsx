import { useCallback, useEffect, useMemo, useState } from 'react';
import { m } from 'framer-motion';
import { Plus, FileText, Music, Video, FileVideo, FolderOpen, FolderSearch, FolderInput, CheckCircle2, AlertCircle, Link, Loader2, Upload, Heart, MessageCircle } from 'lucide-react';
import { springs } from '../ui/lib/motion';
import { getFileNameFromPath } from '../lib/utils';
import type { RecentProjectEntry } from '../lib/electron-api';
import type { VideoImportSourceInput } from '../lib/video-import-types';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
  Field,
  Input,
} from '../ui';
import { ProjectList } from '../components/ProjectList';
import { ImportScriptDialog } from '../components/script/ImportScriptDialog';
import { SonarInboxPanel } from '../components/setup/SonarInboxPanel';
import {
  deriveProjectName,
  inboxItemToOriginalMarkdown,
  type SonarInboxItem,
} from '../lib/sonar-inbox';
import {
  AutoModeSection,
  type AutoModeModelBinding,
  type AutoModeOption,
} from '../components/script/AutoModeSection';
import type { AISettings } from '../types/ai';
import { normalizeTTSSettings } from '../lib/tts-settings';
import { useScriptStore } from '../store/script';
import { loadAISettings, type AutoWorkflowParams } from '../store/ai';
import { getAllRoles } from '../lib/script-templates';
import heroBg from '../assets/hero-bg.png';
import { DonateDialog } from '../components/Donate';
import { ContactDialog } from '../components/Contact';
import styles from './Setup.module.css';

interface SetupProps {
  busy: boolean;
  errorMessage: string | null;
  projectName: string;
  recentProjects: RecentProjectEntry[];
  onComplete: (audioPath: string, srtPath: string) => Promise<void>;
  onOpenRecentProject: (projectDir: string) => Promise<void>;
  onRemoveRecentProject?: (projectDir: string) => Promise<void> | void;
  /** 文稿导入完成回调：传入父目录、项目名、原稿内容、是否一键成稿、自动模式参数、写稿模型绑定 */
  onImportScript: (
    parentDir: string,
    projectName: string,
    content: string,
    autoMode: boolean,
    autoParams: AutoWorkflowParams,
    modelBinding: AutoModeModelBinding | null,
  ) => Promise<void>;
  onOpenSettings: () => void;
  /** 媒体导入完成回调：传入父目录、标题、导入源（抖音链接 / 本地视频 / 本地音频）、是否一键成稿、自动模式参数、写稿模型绑定 */
  onMediaImport: (
    parentDir: string,
    title: string,
    source: VideoImportSourceInput,
    autoMode: boolean,
    autoParams: AutoWorkflowParams,
    modelBinding: AutoModeModelBinding | null,
  ) => Promise<void>;
  /** 导入项目回调：打开导入项目向导（处理跨机器项目目录识别与路径修复） */
  onImportProject: () => void;
}

interface ScanResult {
  dir: string;
  audioFiles: string[];
  srtFiles: string[];
}

export function Setup({
  busy,
  errorMessage,
  projectName,
  recentProjects,
  onComplete,
  onOpenRecentProject,
  onRemoveRecentProject,
  onImportScript,
  onOpenSettings,
  onMediaImport,
  onImportProject,
}: SetupProps) {
  // ── 音频导入弹窗状态 ──
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedAudio, setSelectedAudio] = useState<string | null>(null);
  const [selectedSrt, setSelectedSrt] = useState<string | null>(null);

  // ── 导入文稿弹窗状态 ──
  const [importScriptOpen, setImportScriptOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [importScriptCreating, setImportScriptCreating] = useState(false);
  const [importScriptError, setImportScriptError] = useState<string | null>(null);
  // ── 待创作箱触发的预填项（非空表示当前弹窗服务于某条 inbox 素材）──
  const [inboxDraftItem, setInboxDraftItem] = useState<SonarInboxItem | null>(null);

  // ── 抖音导入弹窗状态 ──
  const [douyinDialogOpen, setDouyinDialogOpen] = useState(false);
  const [douyinUrl, setDouyinUrl] = useState('');
  const [douyinResolving, setDouyinResolving] = useState(false);
  const [douyinTitle, setDouyinTitle] = useState<string | null>(null);
  const [douyinParentDir, setDouyinParentDir] = useState<string | null>(null);
  const [douyinError, setDouyinError] = useState<string | null>(null);
  const [douyinCreating, setDouyinCreating] = useState(false);

  // ── 本地视频导入弹窗状态 ──
  const [localVideoDialogOpen, setLocalVideoDialogOpen] = useState(false);
  const [localVideoPath, setLocalVideoPath] = useState<string | null>(null);
  const [localVideoTitle, setLocalVideoTitle] = useState('');
  const [localVideoParentDir, setLocalVideoParentDir] = useState<string | null>(null);
  const [localVideoError, setLocalVideoError] = useState<string | null>(null);
  const [localVideoCreating, setLocalVideoCreating] = useState(false);

  // ── 一键成稿 (AutoModeSection) 下拉选项与默认值 ──
  // selectedTemplate / selectedRole 来自 script store；voice 默认值需异步从磁盘读取 AISettings
  const selectedTemplate = useScriptStore((s) => s.selectedTemplate);
  const selectedRole = useScriptStore((s) => s.selectedRole);
  const [voiceIdDefault, setVoiceIdDefault] = useState('male-qn-qingse');
  const [aiSettings, setAiSettings] = useState<AISettings | null>(null);
  useEffect(() => {
    void (async () => {
      const settings = await loadAISettings();
      if (!settings) return;
      const normalized = normalizeTTSSettings(settings);
      setAiSettings(normalized);
      const defaultVoice = normalized.ttsVoices.find(
        (voice) => voice.id === normalized.defaultTtsVoiceId,
      );
      if (defaultVoice) {
        setVoiceIdDefault(
          defaultVoice.providerType === 'minimax' && defaultVoice.voiceId
            ? defaultVoice.voiceId
            : defaultVoice.id,
        );
      }
    })();
  }, []);

  const autoModeOptions = useMemo(() => {
    const models: AutoModeOption[] = [];
    for (const provider of aiSettings?.llmProviders ?? []) {
      for (const model of provider.models ?? []) {
        models.push({
          value: `${provider.id}::${model}`,
          label: `${provider.name} / ${model}`,
        });
      }
    }
    const defaultModelBinding: AutoModeModelBinding | null =
      aiSettings?.defaultProviderId && aiSettings?.defaultModel
        ? { providerId: aiSettings.defaultProviderId, model: aiSettings.defaultModel }
        : null;
    return {
      // getAllRoles() 已合并：NONE_ROLE + 内置模板（派生角色）+ 用户自定义角色，
      // 与 AI 写稿工作台 QuickActionBar 的角色下拉保持一致口径。
      roles: getAllRoles().map((r) => ({ value: r.id, label: r.name })),
      voices: (aiSettings?.ttsVoices ?? []).map((voice) => ({
        value: voice.providerType === 'minimax' && voice.voiceId ? voice.voiceId : voice.id,
        label: `${voice.name}${voice.source === 'cloned' ? '（克隆）' : ''}`,
      })),
      models,
      defaults: {
        // templateId 在 UI 上不再暴露；沿用当前工作台选中的模板作为写稿结构，
        // role 作为风格/身份前缀。与 ScriptWorkbench 运行时口径一致。
        templateId: selectedTemplate || 'news-broadcast',
        roleId: selectedRole || 'none',
        voiceId: voiceIdDefault,
      } satisfies AutoWorkflowParams,
      defaultModelBinding,
    };
  }, [aiSettings, selectedTemplate, selectedRole, voiceIdDefault]);

  // 待创作箱「生成初稿」：打开预填的「导入文稿」弹窗，让用户选目录/写稿模型/角色/音色，
  // 默认一键模式开 + 二创转述模板；确认后走与普通导入完全相同的 onImportScript。
  const handleRequestDraftFromInbox = useCallback((item: SonarInboxItem) => {
    setInboxDraftItem(item);
    setImportScriptError(null);
    setImportScriptCreating(false);
    setImportScriptOpen(true);
  }, []);

  // ── 抖音弹窗的一键成稿状态 ──
  const [douyinAutoMode, setDouyinAutoMode] = useState(false);
  const [douyinAutoParams, setDouyinAutoParams] = useState<AutoWorkflowParams>(autoModeOptions.defaults);
  const [douyinModelBinding, setDouyinModelBinding] = useState<AutoModeModelBinding | null>(
    autoModeOptions.defaultModelBinding,
  );
  useEffect(() => {
    if (!douyinDialogOpen) {
      setDouyinAutoMode(false);
      setDouyinAutoParams(autoModeOptions.defaults);
      setDouyinModelBinding(autoModeOptions.defaultModelBinding);
    }
  }, [douyinDialogOpen, autoModeOptions.defaults, autoModeOptions.defaultModelBinding]);

  // ── 本地视频弹窗的一键成稿状态 ──
  const [localVideoAutoMode, setLocalVideoAutoMode] = useState(false);
  const [localVideoAutoParams, setLocalVideoAutoParams] = useState<AutoWorkflowParams>(autoModeOptions.defaults);
  const [localVideoModelBinding, setLocalVideoModelBinding] = useState<AutoModeModelBinding | null>(
    autoModeOptions.defaultModelBinding,
  );
  useEffect(() => {
    if (!localVideoDialogOpen) {
      setLocalVideoAutoMode(false);
      setLocalVideoAutoParams(autoModeOptions.defaults);
      setLocalVideoModelBinding(autoModeOptions.defaultModelBinding);
    }
  }, [localVideoDialogOpen, autoModeOptions.defaults, autoModeOptions.defaultModelBinding]);

  const canImport = useMemo(
    () => Boolean(selectedAudio && selectedSrt && !busy),
    [selectedAudio, selectedSrt, busy],
  );

  const handleOpenImportDialog = useCallback(() => {
    setScanResult(null);
    setSelectedAudio(null);
    setSelectedSrt(null);
    setImportDialogOpen(true);
  }, []);

  // ── 导入文稿弹窗操作 ──
  const handleOpenImportScript = useCallback(() => {
    setInboxDraftItem(null);
    setImportScriptError(null);
    setImportScriptCreating(false);
    setImportScriptOpen(true);
  }, []);

  const handleConfirmImportScript = useCallback(
    async (
      parentDir: string,
      projectNameInput: string,
      content: string,
      autoMode: boolean,
      autoParams: AutoWorkflowParams,
      modelBinding: AutoModeModelBinding | null,
    ) => {
      setImportScriptCreating(true);
      setImportScriptError(null);
      try {
        await onImportScript(parentDir, projectNameInput, content, autoMode, autoParams, modelBinding);
        // 来自待创作箱：项目已创建并起飞流水线 → 标记该收件项为「已生成」并记录项目路径，避免重复创作。
        if (inboxDraftItem) {
          void window.electronAPI
            .sonarInboxMarkStatus?.(inboxDraftItem.id, 'drafted', {
              projectPath: `${parentDir}/${projectNameInput}`,
            })
            .catch(() => {});
          setInboxDraftItem(null);
        }
        setImportScriptOpen(false);
      } catch (err) {
        setImportScriptError(err instanceof Error ? err.message : '创建项目失败');
      } finally {
        setImportScriptCreating(false);
      }
    },
    [onImportScript, inboxDraftItem],
  );

  // 弹窗关闭（含取消）：清空 inbox 预填，收件项保持 pending。
  const handleImportScriptOpenChange = useCallback((next: boolean) => {
    setImportScriptOpen(next);
    if (!next) setInboxDraftItem(null);
  }, []);

  // ── 抖音导入弹窗操作 ──
  const handleOpenDouyinDialog = useCallback(() => {
    setDouyinUrl('');
    setDouyinTitle(null);
    setDouyinParentDir(null);
    setDouyinError(null);
    setDouyinResolving(false);
    setDouyinCreating(false);
    setDouyinDialogOpen(true);
  }, []);

  /** 解析抖音链接，提取视频标题 */
  const handleResolveDouyinUrl = useCallback(async () => {
    if (!douyinUrl.trim()) return;
    setDouyinResolving(true);
    setDouyinError(null);
    setDouyinTitle(null);

    try {
      const { title } = await window.electronAPI.resolveDouyinUrl(douyinUrl);
      setDouyinTitle(title);
    } catch (err) {
      setDouyinError(err instanceof Error ? err.message : '解析失败，请检查链接是否有效');
    } finally {
      setDouyinResolving(false);
    }
  }, [douyinUrl]);

  /** 选择项目存放的父目录 */
  const handleSelectDouyinDir = useCallback(async () => {
    const dir = await window.electronAPI.selectProjectDirectory();
    if (dir) setDouyinParentDir(dir);
  }, []);

  /** 确认创建项目：在父目录下建立以标题命名的文件夹，携带原始链接自动触发下载转录 */
  const handleDouyinConfirm = useCallback(async () => {
    if (!douyinTitle || !douyinParentDir || !douyinUrl.trim()) return;
    setDouyinCreating(true);
    setDouyinError(null);

    try {
      await onMediaImport(
        douyinParentDir,
        douyinTitle,
        { sourceType: 'douyin', url: douyinUrl.trim() },
        douyinAutoMode,
        douyinAutoParams,
        douyinAutoMode ? douyinModelBinding : null,
      );
      setDouyinDialogOpen(false);
    } catch (err) {
      setDouyinError(err instanceof Error ? err.message : '创建项目失败');
    } finally {
      setDouyinCreating(false);
    }
  }, [douyinTitle, douyinParentDir, douyinUrl, douyinAutoMode, douyinAutoParams, douyinModelBinding, onMediaImport]);

  const canCreateDouyinProject = Boolean(douyinTitle && douyinParentDir && !douyinCreating);

  // ── 本地视频导入弹窗操作 ──
  const handleOpenLocalVideoDialog = useCallback(() => {
    setLocalVideoPath(null);
    setLocalVideoTitle('');
    setLocalVideoParentDir(null);
    setLocalVideoError(null);
    setLocalVideoCreating(false);
    setLocalVideoDialogOpen(true);
  }, []);

  /** 选择本地视频文件，并以文件名（去扩展名）推导默认工程名 */
  const handleSelectLocalVideoFile = useCallback(async () => {
    const selected = await window.electronAPI.selectMediaFile('video');
    if (!selected) return;
    setLocalVideoPath(selected);
    setLocalVideoError(null);
    const stem = getFileNameFromPath(selected).replace(/\.[^.]+$/, '').trim();
    setLocalVideoTitle((prev) => (prev.trim() ? prev : stem || '本地视频'));
  }, []);

  /** 选择项目存放的父目录 */
  const handleSelectLocalVideoDir = useCallback(async () => {
    const dir = await window.electronAPI.selectProjectDirectory();
    if (dir) setLocalVideoParentDir(dir);
  }, []);

  /** 确认创建项目：在父目录下建立以工程名命名的文件夹，携带本地视频路径自动触发复制+转录（跳过下载） */
  const handleLocalVideoConfirm = useCallback(async () => {
    const title = localVideoTitle.trim();
    if (!localVideoPath || !title || !localVideoParentDir) return;
    setLocalVideoCreating(true);
    setLocalVideoError(null);

    try {
      await onMediaImport(
        localVideoParentDir,
        title,
        { sourceType: 'local_video', filePath: localVideoPath },
        localVideoAutoMode,
        localVideoAutoParams,
        localVideoAutoMode ? localVideoModelBinding : null,
      );
      setLocalVideoDialogOpen(false);
    } catch (err) {
      setLocalVideoError(err instanceof Error ? err.message : '创建项目失败');
    } finally {
      setLocalVideoCreating(false);
    }
  }, [localVideoPath, localVideoTitle, localVideoParentDir, localVideoAutoMode, localVideoAutoParams, localVideoModelBinding, onMediaImport]);

  const canCreateLocalVideoProject = Boolean(
    localVideoPath && localVideoTitle.trim() && localVideoParentDir && !localVideoCreating,
  );

  const handleSelectDirectory = useCallback(async () => {
    const dir = await window.electronAPI.selectProjectDirectory();
    if (!dir) return;

    setScanning(true);
    setScanResult(null);
    setSelectedAudio(null);
    setSelectedSrt(null);

    try {
      const result = await window.electronAPI.scanImportDirectory(dir);
      setScanResult({ dir, ...result });
      // 自动选中第一个找到的文件
      if (result.audioFiles.length > 0) setSelectedAudio(result.audioFiles[0]);
      if (result.srtFiles.length > 0) setSelectedSrt(result.srtFiles[0]);
    } finally {
      setScanning(false);
    }
  }, []);

  const handleImportConfirm = useCallback(() => {
    if (!selectedAudio || !selectedSrt) return;
    setImportDialogOpen(false);
    void onComplete(selectedAudio, selectedSrt);
  }, [selectedAudio, selectedSrt, onComplete]);

  return (
    <div className={styles.page}>
      <div className={styles.welcomeContent}>
        {/* ── Hero Banner ── */}
        <div className={styles.heroBanner}>
          <img src={heroBg} alt="" className={styles.heroBannerImage} />
          <div className={styles.heroBannerOverlay} />
          {projectName && (
            <div className={styles.projectBadge}>
              <FolderOpen size={13} strokeWidth={1.8} />
              {projectName}
            </div>
          )}
          <button
            type="button"
            className={styles.donateBadge}
            onClick={() => setDonateOpen(true)}
            title="支持作者"
          >
            <Heart size={13} strokeWidth={1.8} />
            支持作者
          </button>
          <button
            type="button"
            className={styles.createButton}
            onClick={handleOpenImportScript}
          >
            <Plus size={18} strokeWidth={2.2} />
            开始创作
          </button>
        </div>

        {/* ── 快捷功能行 ── */}
        <div className={styles.quickBar}>
          <button
            type="button"
            className={styles.quickItem}
            onClick={handleOpenImportScript}
          >
            <div className={styles.quickItemIcon}>
              <FileText size={22} strokeWidth={1.5} />
            </div>
            <span className={styles.quickItemLabel}>导入文稿</span>
          </button>
          <button
            type="button"
            className={styles.quickItem}
            onClick={handleOpenImportDialog}
          >
            {/* Hero ② 共享元素源:此 icon 容器会 morph 到 editor 页 AssetPanel 的口播音频行 */}
            <m.div
              layoutId="setup-editor-audio"
              className={styles.quickItemIcon}
              transition={springs.layout}
            >
              <Music size={22} strokeWidth={1.5} />
            </m.div>
            <span className={styles.quickItemLabel}>导入音频</span>
          </button>
          {/* 抖音导入入口：解析抖音链接 → 提取标题 → 创建项目 */}
          <button
            type="button"
            className={styles.quickItem}
            onClick={handleOpenDouyinDialog}
          >
            <div className={styles.quickItemIcon}>
              <Video size={22} strokeWidth={1.5} />
            </div>
            <span className={styles.quickItemLabel}>抖音导入</span>
          </button>
          {/* 本地视频导入入口：选视频文件 → 创建项目（跳过下载，直接复制+转录） */}
          <button
            type="button"
            className={styles.quickItem}
            onClick={handleOpenLocalVideoDialog}
          >
            <div className={styles.quickItemIcon}>
              <FileVideo size={22} strokeWidth={1.5} />
            </div>
            <span className={styles.quickItemLabel}>本地视频</span>
          </button>
          {/* 导入项目入口：识别跨机器复制过来的项目目录并修复素材路径 */}
          <button
            type="button"
            className={styles.quickItem}
            onClick={onImportProject}
          >
            <div className={styles.quickItemIcon}>
              <FolderInput size={22} strokeWidth={1.5} />
            </div>
            <span className={styles.quickItemLabel}>导入项目</span>
          </button>
        </div>

        {/* ── 工作区：左侧待创作箱 / 右侧本地草稿，各自独立滚动，互不挤压 ── */}
        <div className={styles.workspaceRow}>
          {/* 待创作箱（声呐监听推入的二创素材） */}
          <SonarInboxPanel onRequestDraft={handleRequestDraftFromInbox} />

          {/* 本地草稿 */}
          <div className={styles.draftsSection}>
            <ProjectList
              projects={recentProjects}
              onOpenProject={onOpenRecentProject}
              onRemoveProject={onRemoveRecentProject}
            />
          </div>
        </div>
          {/* 底部常驻：联系作者与赞赏支持 */}
          <div className={styles.supportBar}>
            <span className={styles.supportBarText}>喜欢灵机剪影？欢迎联系作者交流，或赞赏支持作者持续维护</span>
            <div className={styles.supportBarActions}>
              <button
                type="button"
                className={styles.supportBarButton}
                onClick={() => setContactOpen(true)}
              >
                <MessageCircle size={14} strokeWidth={1.8} />
                联系作者
              </button>
              <button
                type="button"
                className={styles.supportBarButton}
                onClick={() => setDonateOpen(true)}
              >
                <Heart size={14} strokeWidth={1.8} />
                赞赏支持
              </button>
            </div>
          </div>
      </div>

      {/* ── 导入弹窗 ── */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent size="md">
          <DialogClose />
          <DialogHeader>
            <DialogTitle>导入音频与字幕</DialogTitle>
            <DialogDescription>
              选择一个目录，系统将自动识别其中的音频和 SRT 字幕文件
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {/* 选择目录按钮 */}
            <button
              type="button"
              className={styles.dirPickerButton}
              onClick={handleSelectDirectory}
              disabled={scanning}
            >
              <FolderSearch size={20} strokeWidth={1.5} />
              <span className={styles.dirPickerText}>
                {scanning
                  ? '正在扫描...'
                  : scanResult
                    ? scanResult.dir
                    : '点击选择目录'}
              </span>
            </button>

            {/* 扫描结果 */}
            {scanResult && (
              <div className={styles.scanResults}>
                {/* 音频文件 */}
                <div className={styles.scanGroup}>
                  <div className={styles.scanGroupHeader}>
                    {scanResult.audioFiles.length > 0 ? (
                      <CheckCircle2 size={14} strokeWidth={2} className={styles.scanIconOk} />
                    ) : (
                      <AlertCircle size={14} strokeWidth={2} className={styles.scanIconWarn} />
                    )}
                    <span className={styles.scanGroupTitle}>
                      音频文件
                      <span className={styles.scanGroupCount}>
                        ({scanResult.audioFiles.length})
                      </span>
                    </span>
                  </div>
                  {scanResult.audioFiles.length > 0 ? (
                    <div className={styles.scanFileList} role="radiogroup" aria-label="选择音频文件">
                      {scanResult.audioFiles.map((f) => (
                        <Button
                          key={f}
                          type="button"
                          variant={selectedAudio === f ? 'primary' : 'ghost'}
                          size="sm"
                          fullWidth
                          onClick={() => setSelectedAudio(f)}
                          aria-pressed={selectedAudio === f}
                          className="justify-start"
                        >
                          <span className={styles.scanFileName}>
                            {getFileNameFromPath(f)}
                          </span>
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.scanEmpty}>未找到音频文件</div>
                  )}
                </div>

                {/* SRT 文件 */}
                <div className={styles.scanGroup}>
                  <div className={styles.scanGroupHeader}>
                    {scanResult.srtFiles.length > 0 ? (
                      <CheckCircle2 size={14} strokeWidth={2} className={styles.scanIconOk} />
                    ) : (
                      <AlertCircle size={14} strokeWidth={2} className={styles.scanIconWarn} />
                    )}
                    <span className={styles.scanGroupTitle}>
                      字幕文件
                      <span className={styles.scanGroupCount}>
                        ({scanResult.srtFiles.length})
                      </span>
                    </span>
                  </div>
                  {scanResult.srtFiles.length > 0 ? (
                    <div className={styles.scanFileList} role="radiogroup" aria-label="选择字幕文件">
                      {scanResult.srtFiles.map((f) => (
                        <Button
                          key={f}
                          type="button"
                          variant={selectedSrt === f ? 'primary' : 'ghost'}
                          size="sm"
                          fullWidth
                          onClick={() => setSelectedSrt(f)}
                          aria-pressed={selectedSrt === f}
                          className="justify-start"
                        >
                          <span className={styles.scanFileName}>
                            {getFileNameFromPath(f)}
                          </span>
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.scanEmpty}>未找到 SRT 字幕文件</div>
                  )}
                </div>
              </div>
            )}

            {errorMessage && (
              <div style={{ marginTop: 'var(--space-6)' }}>
                <Alert variant="error">{errorMessage}</Alert>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">取消</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={!canImport}
              onClick={handleImportConfirm}
            >
              {busy ? '正在初始化...' : '导入并开始'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 导入文稿弹窗：粘贴/拖拽/选择文件 → 选目录 → 起飞 AI 写稿 ── */}
      <ImportScriptDialog
        open={importScriptOpen}
        busy={importScriptCreating}
        errorMessage={importScriptError}
        onOpenChange={handleImportScriptOpenChange}
        onConfirm={handleConfirmImportScript}
        autoModeOptions={autoModeOptions}
        initialContent={inboxDraftItem ? inboxItemToOriginalMarkdown(inboxDraftItem) : undefined}
        initialProjectName={inboxDraftItem ? deriveProjectName(inboxDraftItem) : undefined}
        initialAutoMode={inboxDraftItem ? true : undefined}
        templateIdOverride={inboxDraftItem ? 'rewrite-remix' : undefined}
      />

      {/* ── 抖音导入弹窗：解析链接 → 选择目录 → 创建项目 ── */}
      <Dialog open={douyinDialogOpen} onOpenChange={setDouyinDialogOpen}>
        <DialogContent size="md">
          <DialogClose />
          <DialogHeader>
            <DialogTitle>抖音视频导入</DialogTitle>
            <DialogDescription>
              粘贴抖音分享链接，自动解析视频标题并创建同名项目文件夹
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {/* 链接输入 + 解析按钮 */}
            <Field label="抖音视频链接">
              <div className={styles.douyinUrlRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Input
                    type="text"
                    value={douyinUrl}
                    onChange={(e) => setDouyinUrl(e.target.value)}
                    placeholder="粘贴抖音分享链接，如 https://v.douyin.com/..."
                    leftIcon={<Link size={16} strokeWidth={1.5} />}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && douyinUrl.trim() && !douyinResolving) {
                        void handleResolveDouyinUrl();
                      }
                    }}
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void handleResolveDouyinUrl()}
                  disabled={!douyinUrl.trim() || douyinResolving}
                >
                  {douyinResolving ? (
                    <>
                      <Loader2 size={14} className={styles.spinIcon} />
                      解析中
                    </>
                  ) : '解析链接'}
                </Button>
              </div>
            </Field>

            {/* 解析成功：显示标题 */}
            {douyinTitle && (
              <div className={styles.douyinResultCard}>
                <CheckCircle2 size={16} strokeWidth={2} className={styles.douyinResultIcon} />
                <div className={styles.douyinResultBody}>
                  <span className={styles.douyinResultLabel}>视频标题</span>
                  <span className={styles.douyinResultTitle}>{douyinTitle}</span>
                </div>
              </div>
            )}

            {/* 选择项目存放目录 */}
            {douyinTitle && (
              <button
                type="button"
                className={styles.dirPickerButton}
                onClick={() => void handleSelectDouyinDir()}
                style={{ marginTop: 'var(--space-6)' }}
              >
                <FolderSearch size={20} strokeWidth={1.5} />
                <span className={styles.dirPickerText}>
                  {douyinParentDir
                    ? douyinParentDir
                    : '选择项目存放目录'}
                </span>
              </button>
            )}

            {/* 预览最终项目路径 */}
            {douyinTitle && douyinParentDir && (
              <div className={styles.douyinProjectPath}>
                <FolderOpen size={14} strokeWidth={1.5} />
                <span>项目将创建在：{douyinParentDir}/{douyinTitle}</span>
              </div>
            )}

            {/* 一键成稿（自动写稿、TTS、卡片、封面，跳过审稿） */}
            {douyinTitle && (
              <div style={{ marginTop: 'var(--space-6)' }}>
                <AutoModeSection
                  enabled={douyinAutoMode}
                  onToggle={setDouyinAutoMode}
                  params={douyinAutoParams}
                  onChangeParams={setDouyinAutoParams}
                  roleOptions={autoModeOptions.roles}
                  voiceOptions={autoModeOptions.voices}
                  modelOptions={autoModeOptions.models}
                  modelBinding={douyinModelBinding}
                  onChangeModelBinding={setDouyinModelBinding}
                />
              </div>
            )}

            {/* 错误提示 */}
            {douyinError && (
              <div style={{ marginTop: 'var(--space-6)' }}>
                <Alert variant="error">{douyinError}</Alert>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">取消</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={!canCreateDouyinProject}
              onClick={() => void handleDouyinConfirm()}
            >
              {douyinCreating ? '创建中...' : '创建项目并开始创作'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 本地视频导入弹窗：选视频文件 → 编辑工程名 → 选目录 → 创建项目（跳过下载） ── */}
      <Dialog open={localVideoDialogOpen} onOpenChange={setLocalVideoDialogOpen}>
        <DialogContent size="md">
          <DialogClose />
          <DialogHeader>
            <DialogTitle>本地视频导入</DialogTitle>
            <DialogDescription>
              选择本地视频文件，自动复制并转录为新项目的素材（无需下载）
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {/* 选择视频文件 */}
            <Field label="视频文件">
              <button
                type="button"
                className={styles.dirPickerButton}
                onClick={() => void handleSelectLocalVideoFile()}
              >
                {localVideoPath ? <FileVideo size={20} strokeWidth={1.5} /> : <Upload size={20} strokeWidth={1.5} />}
                <span className={styles.dirPickerText}>
                  {localVideoPath ? getFileNameFromPath(localVideoPath) : '选择视频文件'}
                </span>
              </button>
            </Field>

            {/* 工程名（默认取文件名，可编辑） */}
            {localVideoPath && (
              <div style={{ marginTop: 'var(--space-6)' }}>
                <Field label="工程名">
                  <Input
                    type="text"
                    value={localVideoTitle}
                    onChange={(e) => setLocalVideoTitle(e.target.value)}
                    placeholder="项目文件夹名称"
                  />
                </Field>
              </div>
            )}

            {/* 选择项目存放目录 */}
            {localVideoPath && (
              <button
                type="button"
                className={styles.dirPickerButton}
                onClick={() => void handleSelectLocalVideoDir()}
                style={{ marginTop: 'var(--space-6)' }}
              >
                <FolderSearch size={20} strokeWidth={1.5} />
                <span className={styles.dirPickerText}>
                  {localVideoParentDir ? localVideoParentDir : '选择项目存放目录'}
                </span>
              </button>
            )}

            {/* 预览最终项目路径 */}
            {localVideoPath && localVideoTitle.trim() && localVideoParentDir && (
              <div className={styles.douyinProjectPath}>
                <FolderOpen size={14} strokeWidth={1.5} />
                <span>项目将创建在：{localVideoParentDir}/{localVideoTitle.trim()}</span>
              </div>
            )}

            {/* 一键成稿（自动写稿、TTS、卡片、封面，跳过审稿） */}
            {localVideoPath && (
              <div style={{ marginTop: 'var(--space-6)' }}>
                <AutoModeSection
                  enabled={localVideoAutoMode}
                  onToggle={setLocalVideoAutoMode}
                  params={localVideoAutoParams}
                  onChangeParams={setLocalVideoAutoParams}
                  roleOptions={autoModeOptions.roles}
                  voiceOptions={autoModeOptions.voices}
                  modelOptions={autoModeOptions.models}
                  modelBinding={localVideoModelBinding}
                  onChangeModelBinding={setLocalVideoModelBinding}
                />
              </div>
            )}

            {/* 错误提示 */}
            {localVideoError && (
              <div style={{ marginTop: 'var(--space-6)' }}>
                <Alert variant="error">{localVideoError}</Alert>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">取消</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={!canCreateLocalVideoProject}
              onClick={() => void handleLocalVideoConfirm()}
            >
              {localVideoCreating ? '创建中...' : '创建项目并开始创作'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DonateDialog open={donateOpen} onOpenChange={setDonateOpen} />
      <ContactDialog open={contactOpen} onOpenChange={setContactOpen} />
    </div>
  );
}
