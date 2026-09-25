import { Save } from 'lucide-react';
import { Button } from '../../ui';

interface OperationBarProps {
  originalStats: { charCount: number; lineCount: number };
  scriptStats: { charCount: number; lineCount: number; estimatedDuration: string };
  annotationSummary: { total: number; pending: number; accepted: number; dismissed: number };
  onBack: () => void;
  onSave: () => void;
}

function renderSummary({
  originalStats,
  scriptStats,
  annotationSummary,
}: Pick<OperationBarProps, 'originalStats' | 'scriptStats' | 'annotationSummary'>) {
  const parts: string[] = [];

  if (originalStats.charCount > 0) {
    parts.push(`原稿 ${originalStats.charCount.toLocaleString()} 字 · ${originalStats.lineCount} 行`);
  }

  if (scriptStats.charCount > 0) {
    parts.push(`口播稿 ${scriptStats.charCount.toLocaleString()} 字 · 约 ${scriptStats.estimatedDuration}`);
  }

  if (annotationSummary.total > 0) {
    parts.push(`批注 ${annotationSummary.total} 条 · 待处理 ${annotationSummary.pending}`);
  }

  return parts.length > 0 ? parts.join('  |  ') : '请选择工作目录并导入原稿';
}

export function OperationBar({
  originalStats,
  scriptStats,
  annotationSummary,
  onBack,
  onSave,
}: OperationBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '10px 18px',
        borderBottom: '1px solid var(--color-border-subtle)',
        background: 'var(--color-panel-bg)',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', flex: 1, minWidth: 0 }}>
        {renderSummary({ originalStats, scriptStats, annotationSummary })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Save size={14} />}
          onClick={onSave}
        >
          保存
        </Button>
        <Button variant="secondary" size="sm" onClick={onBack}>
          返回
        </Button>
      </div>
    </div>
  );
}
