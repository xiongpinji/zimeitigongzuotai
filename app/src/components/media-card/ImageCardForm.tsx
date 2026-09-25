import { useEffect, useState } from 'react';
import type {
  AICard,
  AICardDisplayMode,
  ImageAspectRatio,
  MediaCardContent,
} from '../../types/ai';
import { Button, Input, Select, Textarea } from '../../ui';
import { MediaCardPreview } from './MediaCardPreview';
import styles from './ImageCardForm.module.css';

export interface ImageProviderOption {
  id: string;
  name: string;
  models: string[];
}

export interface ImageCardFormProps {
  card: AICard;
  /** 当前进度，0-100，仅在 generating 时有意义 */
  percent?: number;
  /** 解析好的本地预览 src（绝对 file:// 或 https://），仅 ready 时由父组件提供 */
  previewSrc: string | null;
  /** 可选的 image providers 列表（用于下拉） */
  imageProviders: ImageProviderOption[];
  onGenerate: () => void;
  onCancel: () => void;
  onClose: () => void;
  onSave: (cardId: string, updates: Partial<AICard>) => void;
}

const ASPECT_OPTIONS: ImageAspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const DISPLAY_MODE_OPTIONS: AICardDisplayMode[] = ['fullscreen', 'pip'];

function getMediaContent(card: AICard): MediaCardContent | null {
  return card.content && typeof card.content === 'object' && 'mediaType' in card.content
    ? (card.content as MediaCardContent)
    : null;
}

function buildFallbackContent(
  aspectRatio: ImageAspectRatio,
  prompt: string,
  providerId: string | null,
  model: string | null,
): MediaCardContent {
  return {
    mediaType: 'image',
    assetPath: null,
    aspectRatio,
    prompt,
    providerId,
    model,
    generationStatus: 'idle',
  };
}

export function ImageCardForm({
  card,
  percent,
  previewSrc,
  imageProviders,
  onGenerate,
  onCancel,
  onClose,
  onSave,
}: ImageCardFormProps) {
  const initialContent = getMediaContent(card);

  const [title, setTitle] = useState(card.title);
  const [prompt, setPrompt] = useState(initialContent?.prompt ?? '');
  const [negativePrompt, setNegativePrompt] = useState(initialContent?.negativePrompt ?? '');
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>(
    (initialContent?.aspectRatio as ImageAspectRatio | undefined) ?? '16:9',
  );
  const [displayMode, setDisplayMode] = useState<AICardDisplayMode>(card.displayMode);
  const [displayDurationMs, setDisplayDurationMs] = useState<number>(card.displayDurationMs);
  const [providerId, setProviderId] = useState<string | null>(initialContent?.providerId ?? null);
  const [model, setModel] = useState<string | null>(initialContent?.model ?? null);

  // 外部 card 变化时同步本地 state
  useEffect(() => {
    const c = getMediaContent(card);
    setTitle(card.title);
    setDisplayMode(card.displayMode);
    setDisplayDurationMs(card.displayDurationMs);
    if (c) {
      setPrompt(c.prompt ?? '');
      setNegativePrompt(c.negativePrompt ?? '');
      setAspectRatio((c.aspectRatio as ImageAspectRatio) ?? '16:9');
      setProviderId(c.providerId ?? null);
      setModel(c.model ?? null);
    }
  }, [card]);

  const status = initialContent?.generationStatus ?? 'idle';
  const isGenerating = status === 'generating' || status === 'pending';
  const clampedPercent = Math.max(0, Math.min(100, percent ?? 0));
  const primaryButtonLabel = isGenerating
    ? `取消 ${clampedPercent}%`
    : status === 'ready'
      ? '重新生成'
      : '生成';

  const selectedProvider = imageProviders.find((p) => p.id === providerId) ?? null;

  const handleSave = () => {
    const base = initialContent ?? buildFallbackContent(aspectRatio, prompt, providerId, model);
    const updatedContent: MediaCardContent = {
      ...base,
      prompt,
      negativePrompt: negativePrompt.trim() ? negativePrompt : undefined,
      aspectRatio,
      providerId,
      model,
    };
    onSave(card.id, {
      title,
      displayMode,
      displayDurationMs,
      content: updatedContent,
    });
  };

  // 给 MediaCardPreview 的 content：优先用真实 content；缺失时用本地表单状态构造一个 idle 占位
  const previewContent: MediaCardContent =
    initialContent ?? buildFallbackContent(aspectRatio, prompt, providerId, model);

  return (
    <div className={styles.root}>
      <div className={styles.previewSection}>
        <MediaCardPreview content={previewContent} previewSrc={previewSrc} percent={percent} />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>标题</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>提示词</label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="描述图像内容、风格、镜头语言"
        />
      </div>

      <details className={styles.field}>
        <summary className={styles.summary}>负面提示词（可选）</summary>
        <Textarea
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          rows={2}
          placeholder="不希望出现的元素"
        />
      </details>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label}>画幅比例</label>
          <Select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as ImageAspectRatio)}
            options={ASPECT_OPTIONS.map((v) => ({ value: v, label: v }))}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>显示模式</label>
          <Select
            value={displayMode}
            onChange={(e) => setDisplayMode(e.target.value as AICardDisplayMode)}
            options={DISPLAY_MODE_OPTIONS.map((v) => ({
              value: v,
              label: v === 'fullscreen' ? '全屏' : '画中画',
            }))}
          />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>显示时长（ms）</label>
        <Input
          type="number"
          value={String(displayDurationMs)}
          onChange={(e) => setDisplayDurationMs(Number(e.target.value) || 0)}
        />
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label}>Provider</label>
          <Select
            value={providerId ?? ''}
            onChange={(e) => {
              const v = e.target.value || null;
              setProviderId(v);
              setModel(null);
            }}
            options={[
              { value: '', label: '使用默认绑定' },
              ...imageProviders.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Model</label>
          <Select
            value={model ?? ''}
            onChange={(e) => setModel(e.target.value || null)}
            disabled={!selectedProvider}
            options={[
              { value: '', label: '使用默认绑定' },
              ...(selectedProvider?.models ?? []).map((m) => ({ value: m, label: m })),
            ]}
          />
        </div>
      </div>

      <div className={styles.buttonRow}>
        <Button variant="secondary" onClick={onClose}>
          取消编辑
        </Button>
        <Button variant="secondary" onClick={handleSave}>
          保存
        </Button>
        <Button
          variant={isGenerating ? 'destructive' : 'primary'}
          onClick={isGenerating ? onCancel : onGenerate}
        >
          {primaryButtonLabel}
        </Button>
      </div>
    </div>
  );
}
