import { Eye } from 'lucide-react';
import { useState } from 'react';
import { useScriptStore } from '../../store/script';
import styles from './VersionPreviewBar.module.css';

/** 格式化时间 */
function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${mo}-${dd} ${hh}:${mm}`;
}

/**
 * 历史版本预览横幅
 * 当 historyPreview.active === true 时显示
 */
export function VersionPreviewBar() {
  const historyPreview = useScriptStore((s) => s.historyPreview);
  const exitHistoryPreview = useScriptStore((s) => s.exitHistoryPreview);
  const setScriptText = useScriptStore((s) => s.setScriptText);
  const setFileDirty = useScriptStore((s) => s.setFileDirty);
  const markReviewStale = useScriptStore((s) => s.markReviewStale);
  const projectDir = useScriptStore((s) => s.projectDir);
  const scriptText = useScriptStore((s) => s.scriptText);

  const [labelInput, setLabelInput] = useState('');
  const [editingLabel, setEditingLabel] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!historyPreview.active || !historyPreview.versionMeta) return null;

  const { versionId, content, versionMeta } = historyPreview;
  const { source, providerName, modelName, createdAt, label } = versionMeta;

  const isAI = source === 'ai';
  const sourceLabel = isAI ? 'AI 生成' : '手动保存';

  const handleRollback = async () => {
    if (versionId === null || content === null || !projectDir) return;
    setSaving(true);
    try {
      const result = await window.scriptHistoryAPI.rollback(
        versionId,
        scriptText,
        projectDir,
        'script.md',
      );
      setScriptText(result.rollbackContent);
      setFileDirty('script.md', true);
      markReviewStale();
      if (window.electronAPI?.saveScriptFile) {
        await window.electronAPI.saveScriptFile(projectDir, 'script.md', result.rollbackContent);
        setFileDirty('script.md', false);
      }
    } finally {
      setSaving(false);
      exitHistoryPreview();
    }
  };

  const handleSaveLabel = async () => {
    if (versionId === null || !projectDir) return;
    await window.scriptHistoryAPI.updateLabel(projectDir, versionId, labelInput.trim() || null);
    setEditingLabel(false);
    setLabelInput('');
  };

  return (
    <div className={styles.bar}>
      {/* 左侧信息 */}
      <div className={styles.info}>
        <Eye className={styles.infoIcon} />
        <span className={styles.infoTitle}>预览历史版本</span>
        <span className={styles.infoTime}>{formatTime(createdAt)}</span>
        <span className={styles.infoSource}>
          {sourceLabel}
          {providerName && ` · ${providerName}${modelName ? ` / ${modelName}` : ''}`}
        </span>
        {label && (
          <span className={styles.infoLabel}>「{label}」</span>
        )}
      </div>

      {/* 操作区 */}
      <div className={styles.actions}>
        {/* 添加标签 */}
        {editingLabel ? (
          <div className={styles.labelEdit}>
            <input
              autoFocus
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveLabel();
                if (e.key === 'Escape') {
                  setEditingLabel(false);
                  setLabelInput('');
                }
              }}
              placeholder="输入标签…"
              className={styles.labelInput}
            />
            <button
              type="button"
              onClick={() => void handleSaveLabel()}
              className={styles.btnLabel}
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingLabel(false);
                setLabelInput('');
              }}
              className={styles.btn}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditingLabel(true);
              setLabelInput(label ?? '');
            }}
            className={styles.btnLabel}
          >
            添加标签
          </button>
        )}

        {/* 恢复此版本 */}
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleRollback()}
          className={styles.btnPrimary}
        >
          {saving ? '恢复中…' : '恢复此版本'}
        </button>

        {/* 返回当前 */}
        <button
          type="button"
          onClick={exitHistoryPreview}
          className={styles.btn}
        >
          返回当前
        </button>
      </div>
    </div>
  );
}
