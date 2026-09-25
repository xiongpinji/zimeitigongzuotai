import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppIcon } from './AppIcon';
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui';
import {
  AutoModeSection,
  type AutoModeModelBinding,
  type AutoModeOption,
} from './script/AutoModeSection';
import {
  detectResumableAutoRun,
  getResumableStepLabel,
  type ResumableAutoRunInfo,
} from '../lib/auto-run-resume';
import type { AutoWorkflowParams } from '../store/ai';
import { loadAISettings, useAIStore } from '../store/ai';
import { useScriptStore } from '../store/script';
import { getAllRoles } from '../lib/script-templates';
import { normalizeTTSSettings } from '../lib/tts-settings';
import { userPromptBindingKey } from '../lib/prompts';
import type { AISettings } from '../types/ai';
import type { ProjectData } from '../lib/project-persistence';
import type { AppPage } from '../lib/electron-api';
import styles from './AutoRunLauncher.module.css';

const SESSION_DISMISS_KEY_PREFIX = 'auto-run-launcher-dismissed:';

export interface AutoRunLauncherProps {
  projectDir: string;
  setPage: (next: AppPage) => void;
  /** 测试注入 */
  detect?: typeof defaultDetect;
}

/** 把 provider×model 组合扁平成一个 Select 使用的 value/label 对 */
function flattenModelOptions(settings: AISettings | null): AutoModeOption[] {
  if (!settings) return [];
  const out: AutoModeOption[] = [];
  for (const provider of settings.llmProviders ?? []) {
    for (const model of provider.models ?? []) {
      out.push({
        value: `${provider.id}::${model}`,
        label: `${provider.name} / ${model}`,
      });
    }
  }
  return out;
}

/** 当前写稿模板在项目下的已绑定模型；没有则回退到全局 defaultProviderId/defaultModel */
function resolveInitialModelBinding(
  settings: AISettings | null,
  projectBinding: { providerId: string | null; model: string | null } | null | undefined,
): AutoModeModelBinding | null {
  if (projectBinding?.providerId && projectBinding.model) {
    return { providerId: projectBinding.providerId, model: projectBinding.model };
  }
  if (settings?.defaultProviderId && settings.defaultModel) {
    return { providerId: settings.defaultProviderId, model: settings.defaultModel };
  }
  return null;
}

async function defaultDetect(projectDir: string): Promise<
  | { kind: 'none' }
  | ({ kind: 'resumable' } & ResumableAutoRunInfo)
> {
  const api = window.electronAPI;
  if (!api) return { kind: 'none' };

  const [scriptContent, originalContent, projectJson] = await Promise.all([
    api.loadScriptFile(projectDir, 'script.md').catch(() => null),
    api.loadScriptFile(projectDir, 'original.md').catch(() => null),
    api.loadProject(projectDir).catch(() => null),
  ]);

  let project: ProjectData | null = null;
  if (projectJson) {
    try {
      project = JSON.parse(projectJson) as ProjectData;
    } catch {
      project = null;
    }
  }

  return detectResumableAutoRun({ scriptContent, originalContent, project });
}

function sessionDismissed(projectDir: string): boolean {
  try {
    return sessionStorage.getItem(SESSION_DISMISS_KEY_PREFIX + projectDir) === '1';
  } catch {
    return false;
  }
}

function markSessionDismissed(projectDir: string): void {
  try {
    sessionStorage.setItem(SESSION_DISMISS_KEY_PREFIX + projectDir, '1');
  } catch {
    // ignore
  }
}

export function AutoRunLauncher({
  projectDir,
  setPage,
  detect = defaultDetect,
}: AutoRunLauncherProps) {
  const workflowStep = useAIStore((s) => s.workflow.step);
  const setPendingAutoParams = useAIStore((s) => s.setPendingAutoParams);
  const setPendingAutoResumeStep = useAIStore((s) => s.setPendingAutoResumeStep);
  const projectBindings = useAIStore((s) => s.projectBindings);
  const setProjectBinding = useAIStore((s) => s.setProjectBinding);
  const selectedTemplate = useScriptStore((s) => s.selectedTemplate);
  const selectedRole = useScriptStore((s) => s.selectedRole);

  const [resumable, setResumable] = useState<ResumableAutoRunInfo | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => sessionDismissed(projectDir));
  const [configOpen, setConfigOpen] = useState(false);
  const [voiceIdDefault, setVoiceIdDefault] = useState('male-qn-qingse');
  const [aiSettings, setAiSettings] = useState<AISettings | null>(null);
  const [configParams, setConfigParams] = useState<AutoWorkflowParams | null>(null);
  const [modelBinding, setModelBinding] = useState<AutoModeModelBinding | null>(null);

  useEffect(() => {
    setDismissed(sessionDismissed(projectDir));
  }, [projectDir]);

  useEffect(() => {
    void (async () => {
      const settings = await loadAISettings().catch(() => null);
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

  useEffect(() => {
    let cancelled = false;
    if (!projectDir) {
      setResumable(null);
      return () => {
        cancelled = true;
      };
    }
    if (workflowStep !== 'idle' && workflowStep !== 'error') {
      return () => {
        cancelled = true;
      };
    }

    void detect(projectDir).then((result) => {
      if (cancelled) return;
      if (result.kind === 'resumable') {
        setResumable({
          nextStep: result.nextStep,
          nextStepLabel: result.nextStepLabel,
          persistedAutoParams: result.persistedAutoParams,
        });
      } else {
        setResumable(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [detect, projectDir, workflowStep]);

  const autoModeOptions = useMemo(
    () => ({
      roles: getAllRoles().map((r) => ({ value: r.id, label: r.name })),
      voices: (aiSettings?.ttsVoices ?? []).map((voice) => ({
        value: voice.providerType === 'minimax' && voice.voiceId ? voice.voiceId : voice.id,
        label: `${voice.name}${voice.source === 'cloned' ? '（克隆）' : ''}`,
      })),
      models: flattenModelOptions(aiSettings),
    }),
    [aiSettings],
  );

  const launch = useCallback(
    (params: AutoWorkflowParams) => {
      if (!resumable) return;
      setPendingAutoParams(params);
      setPendingAutoResumeStep(resumable.nextStep);
      setPage('auto-run');
    },
    [resumable, setPage, setPendingAutoParams, setPendingAutoResumeStep],
  );

  const handleResume = useCallback(() => {
    if (!resumable?.persistedAutoParams) return;
    launch(resumable.persistedAutoParams);
  }, [launch, resumable]);

  const handleOpenConfig = useCallback(() => {
    const templateId = selectedTemplate || 'news-broadcast';
    setConfigParams({
      templateId,
      roleId: selectedRole || 'none',
      voiceId: voiceIdDefault,
    });
    const projectBinding = projectBindings?.[userPromptBindingKey('script-template', templateId)] ?? null;
    setModelBinding(resolveInitialModelBinding(aiSettings, projectBinding));
    setConfigOpen(true);
  }, [aiSettings, projectBindings, selectedRole, selectedTemplate, voiceIdDefault]);

  const handleConfirmConfig = useCallback(async () => {
    if (!configParams) return;
    // 把写稿模型选择写入项目级绑定（下次一键 / 脚本工作台手动写稿都会用它）
    if (modelBinding) {
      await setProjectBinding(userPromptBindingKey('script-template', configParams.templateId), {
        providerId: modelBinding.providerId,
        model: modelBinding.model,
        imageProviderId: null,
        imageModel: null,
      });
    }
    setConfigOpen(false);
    launch(configParams);
  }, [configParams, launch, modelBinding, setProjectBinding]);

  const handleDismiss = useCallback(() => {
    markSessionDismissed(projectDir);
    setDismissed(true);
  }, [projectDir]);

  if (dismissed || !resumable) return null;

  const canResume = resumable.persistedAutoParams !== null;
  const titleText = canResume ? '检测到未完成的 AI 一键剪辑' : 'AI 一键剪辑';
  const stageText = canResume
    ? `从「${getResumableStepLabel(resumable.nextStep)}」继续`
    : `将从「${getResumableStepLabel(resumable.nextStep)}」开始`;

  const modelHint =
    autoModeOptions.models.length === 0
      ? '未发现可用模型，请先到系统设置添加 Provider。'
      : '作为本项目当前模板的默认写稿模型，下次也会用它。';

  return (
    <>
      <div className={styles.banner} role="status" data-testid="auto-run-launcher">
        <div className={styles.iconWrap}>
          <AppIcon name="sparkles" size={14} />
        </div>
        <div className={styles.message}>
          <span className={styles.title}>{titleText}</span>
          <span className={styles.stageTag}>{stageText}</span>
        </div>
        <div className={styles.actions}>
          {canResume ? (
            <Button
              variant="primary"
              size="sm"
              onClick={handleResume}
              leftIcon={<AppIcon name="refresh-cw" size={12} />}
            >
              继续运行
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleOpenConfig}
              leftIcon={<AppIcon name="sparkles" size={12} />}
            >
              配置并开始
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={handleDismiss}
            aria-label="忽略"
          >
            <AppIcon name="x" size={14} />
          </Button>
        </div>
      </div>

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent size="md">
          <DialogClose />
          <DialogHeader>
            <DialogTitle>配置一键 AI 剪辑</DialogTitle>
            <DialogDescription>
              选择写稿模型、角色与 TTS 音色，确认后将自动完成：
              写稿 → TTS → 内容分析 → 字幕高亮 → 封面 → 时间轴排布。
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {configParams ? (
              <AutoModeSection
                mode="always"
                params={configParams}
                onChangeParams={setConfigParams}
                roleOptions={autoModeOptions.roles}
                voiceOptions={autoModeOptions.voices}
                modelOptions={autoModeOptions.models}
                modelBinding={modelBinding}
                onChangeModelBinding={setModelBinding}
                modelHint={modelHint}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfigOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleConfirmConfig()}
              disabled={!configParams?.voiceId || !modelBinding}
            >
              开始
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
