/**
 * SessionFileSummaryPanel — pi 会话结束后的「本次共改动 N 个文件」结果卡片。
 *
 * 渲染条件由调用方（MessageList）保证：非 streaming。文件数为 0 时本组件返回 null。
 * 每行提供「打开方式」下拉：macOS 快速预览 / 打开 / 在 Finder 中显示；
 * 非 macOS 仅 打开 / 在资源管理器中显示。删除态文件禁用打开/预览。
 */
import { ChevronDown, FileText, Image as ImageIcon, Film, Music, FileCode2, File } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../ui';
import { RollingNumber } from './RollingNumber';
import { summarizeSessionFiles, type FileKind, type SummaryFile } from './session-file-summary';
import type { ConversationTurn } from '../../types/conversation';
import styles from './AgentTranscript.module.css';

const isMac = navigator.platform.toUpperCase().includes('MAC');

const KIND_LABEL: Record<FileKind, string> = {
  image: '图像',
  video: '视频',
  audio: '音频',
  markdown: '文档',
  document: '文档',
  code: '代码',
  other: '文件',
};

function KindIcon({ kind }: { kind: FileKind }) {
  const size = 16;
  switch (kind) {
    case 'image': return <ImageIcon size={size} />;
    case 'video': return <Film size={size} />;
    case 'audio': return <Music size={size} />;
    case 'markdown':
    case 'document': return <FileText size={size} />;
    case 'code': return <FileCode2 size={size} />;
    default: return <File size={size} />;
  }
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

function resolvePath(projectDir: string | null | undefined, p: string): string {
  if (isAbsolute(p) || !projectDir) return p;
  const base = projectDir.replace(/[\\/]+$/, '');
  return `${base}/${p}`;
}

function subtitle(file: SummaryFile): string {
  const label = KIND_LABEL[file.kind];
  return file.ext ? `${label} · ${file.ext}` : label;
}

export function SessionFileSummaryPanel({
  turns,
  projectDir,
}: {
  turns: ConversationTurn[];
  projectDir?: string | null;
}) {
  const summary = summarizeSessionFiles(turns);
  if (summary.files.length === 0) return null;

  const openWith = (file: SummaryFile) => { void window.electronAPI.openPath(resolvePath(projectDir, file.path)); };
  const quickLook = (file: SummaryFile) => { void window.electronAPI.quickLookFile(resolvePath(projectDir, file.path)); };
  const reveal = (file: SummaryFile) => { window.electronAPI.showItemInFolder(resolvePath(projectDir, file.path)); };

  return (
    <div className={styles.sessionFileSummary}>
      <div className={styles.sessionFileSummaryHeader}>
        <span className={styles.sessionFileSummaryTitle}>本次共改动 {summary.files.length} 个文件</span>
        {summary.totalAdded > 0 ? (
          <span className={styles.plus}>+<RollingNumber value={summary.totalAdded} prefix="+" /></span>
        ) : null}
        {summary.totalRemoved > 0 ? (
          <span className={styles.minus}>-<RollingNumber value={summary.totalRemoved} prefix="-" /></span>
        ) : null}
      </div>
      <ul className={styles.sessionFileList}>
        {summary.files.map((file) => {
          const deleted = file.operation === 'delete';
          return (
            <li key={file.path} className={styles.sessionFileRow}>
              <span className={styles.sessionFileIcon}><KindIcon kind={file.kind} /></span>
              <span className={styles.sessionFileMeta}>
                <span className={styles.sessionFileName} title={file.path}>{file.name}</span>
                <span className={styles.sessionFileSub}>{subtitle(file)}</span>
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger className={styles.sessionFileOpenBtn}>
                  打开方式 <ChevronDown size={13} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isMac ? (
                    <DropdownMenuItem disabled={deleted} onSelect={() => quickLook(file)}>
                      快速预览
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem disabled={deleted} onSelect={() => openWith(file)}>
                    打开
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => reveal(file)}>
                    {isMac ? '在 Finder 中显示' : '在资源管理器中显示'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
