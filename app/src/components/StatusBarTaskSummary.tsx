import { useTaskProgressStore } from '../store/task-progress';
import type { TaskCategory } from '../store/task-progress';
import { Progress } from '../ui';

const CATEGORY_ICONS: Record<TaskCategory, string> = {
  'ai-write': '🤖',
  'ai-review': '🔍',
  'ai-analyze': '🧠',
  'import': '📥',
  'export': '🎬',
  'tts': '🎙️',
  'cover': '🖼️',
  'io': '📁',
  'publish': '📤',
};

export function StatusBarTaskSummary() {
  const primaryTask = useTaskProgressStore((s) => s.primaryTask);
  const activeCount = useTaskProgressStore((s) => s.activeCount);
  const panelOpen = useTaskProgressStore((s) => s.panelOpen);
  const setPanelOpen = useTaskProgressStore((s) => s.setPanelOpen);

  if (!primaryTask) return null;

  const icon = CATEGORY_ICONS[primaryTask.category] ?? '📁';
  const isActive = primaryTask.status === 'active';
  const isIndeterminate = isActive && primaryTask.mode !== 'determinate';

  let label: string;
  let suffix = '';
  if (primaryTask.status === 'completed') {
    label = `✅ ${primaryTask.label} 完成`;
  } else if (primaryTask.status === 'error') {
    label = `❌ ${primaryTask.label} 失败`;
  } else {
    label = `${icon} ${primaryTask.label}`;
    if (activeCount > 1) suffix = ` · +${activeCount - 1}`;
  }

  return (
    <span
      onClick={() => setPanelOpen(!panelOpen)}
      style={{
        cursor: 'pointer',
        transition: 'color 0.15s',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
      }}
      title="点击查看任务详情"
    >
      <span>{label}</span>
      {isActive && (
        <Progress
          value={primaryTask.progress}
          size="sm"
          variant="default"
          indeterminate={isIndeterminate}
          className="w-16"
        />
      )}
      {isActive && primaryTask.mode === 'determinate' && (
        <span style={{ fontSize: '10px', fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>
          {primaryTask.progress}%
        </span>
      )}
      {suffix && <span>{suffix}</span>}
    </span>
  );
}
